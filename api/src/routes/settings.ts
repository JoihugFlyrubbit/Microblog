import { Hono } from 'hono';
import { Env } from '../types';

export const settingsRouter = new Hono<{ Bindings: Env }>();

// TODO: Implement settings
// GET /settings - Get user settings
// PUT /settings - Update user settings
settingsRouter.get('/', (c) => c.json({ message: 'Get settings - TODO' }));
settingsRouter.put('/', (c) => c.json({ message: 'Update settings - TODO' }));
