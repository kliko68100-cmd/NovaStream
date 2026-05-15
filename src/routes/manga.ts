import { Router } from 'express';
import * as mangadex from '../services/mangadex.js';

export const mangaRouter = Router();

mangaRouter.get('/popular',         async (req, res) => { try { res.json(await mangadex.getPopularManga(+(req.query.page??1))); } catch(e:any){res.status(500).json({error:e.message});} });
mangaRouter.get('/latest',          async (req, res) => { try { res.json(await mangadex.getLatestManga(+(req.query.page??1))); } catch(e:any){res.status(500).json({error:e.message});} });
mangaRouter.get('/search',          async (req, res) => { try { res.json(await mangadex.searchManga(String(req.query.q??''), +(req.query.page??1))); } catch(e:any){res.status(500).json({error:e.message});} });
mangaRouter.get('/:id',             async (req, res) => { try { res.json(await mangadex.getMangaDetails(req.params.id!)); } catch(e:any){res.status(500).json({error:e.message});} });
mangaRouter.get('/:id/chapters',    async (req, res) => { try { res.json(await mangadex.getMangaChapters(req.params.id!, +(req.query.page??1))); } catch(e:any){res.status(500).json({error:e.message});} });
mangaRouter.get('/chapter/:id/pages', async (req, res) => { try { res.json(await mangadex.getChapterPages(req.params.id!)); } catch(e:any){res.status(500).json({error:e.message});} });
