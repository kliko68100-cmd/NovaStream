import { Router } from 'express';
import { config } from '../config/index.js';
import {
  getAniListUser,
  getUserList,
  updateListEntry,
} from '../services/anilist.js';

export const syncRouter = Router();

// ── AniList OAuth ─────────────────────────────────────────────────

/** Échange le code OAuth contre un access token AniList */
syncRouter.post('/anilist/token', async (req, res) => {
  const { code, redirectUri } = req.body as Record<string, string>;

  if (!code || !redirectUri) {
    return res.status(400).json({ error: 'code et redirectUri requis' });
  }

  if (!config.ANILIST_CLIENT_ID || !config.ANILIST_CLIENT_SECRET) {
    return res.status(503).json({ error: 'AniList OAuth non configuré' });
  }

  try {
    const tokenRes = await fetch('https://anilist.co/api/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: config.ANILIST_CLIENT_ID,
        client_secret: config.ANILIST_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(400).json({ error: 'Token AniList invalide', details: err });
    }

    const tokenData = await tokenRes.json() as any;
    return res.json({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Récupère le profil utilisateur AniList */
syncRouter.get('/anilist/user', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requis' });

  try {
    const user = await getAniListUser(token);
    return res.json(user);
  } catch (err: any) {
    return res.status(401).json({ error: 'Token invalide', message: err.message });
  }
});

/** Récupère la liste anime d'un utilisateur */
syncRouter.get('/anilist/list/:status', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const { userId } = req.query as { userId?: string };
  const { status } = req.params as { status: string };

  if (!userId) return res.status(400).json({ error: 'userId requis' });

  try {
    const list = await getUserList(+userId, status.toUpperCase(), token);
    return res.json({ entries: list, total: list.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** Met à jour une entrée de liste AniList */
syncRouter.put('/anilist/entry', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requis' });

  const { mediaId, status, progress, score } = req.body as Record<string, any>;
  if (!mediaId || !status) return res.status(400).json({ error: 'mediaId et status requis' });

  try {
    await updateListEntry(mediaId, status, progress ?? 0, token, score);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
