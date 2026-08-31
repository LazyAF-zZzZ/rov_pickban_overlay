// ประกอบทุกส่วนเข้าด้วยกันแล้วเปิดเซิร์ฟเวอร์
//
// ลำดับใน createApp สำคัญ: static ของภาพที่ผู้ใช้อัปโหลดต้องมาก่อน
// express.static(PUBLIC_DIR) ไม่งั้นภาพเดิมที่อยู่ใน asar จะบังภาพใหม่

import path from 'path';
import http from 'http';
import express, { Express } from 'express';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';

import { PORT, HOST, CONTROL_TOKEN, PUBLIC_DIR, USER_MEDIA_DIR } from './config';
import { attachIo } from './store/live-state';
import { pageRoutes } from './http/pages';
import { stateRoutes } from './http/api-state';
import { mediaRoutes } from './http/api-media';
import { tournamentRoutes } from './http/api-tournaments';
import { teamRoutes } from './http/api-teams';
import { registerHandlers } from './sockets/handlers';
import { attachDraftCapture } from './services/live-match';

type OriginCallback = (err: Error | null, allow?: boolean) => void;

export function isAllowedOrigin(origin: string | undefined, callback: OriginCallback): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  try {
    const url = new URL(origin);
    const host = url.hostname;
    const allowed =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1';

    callback(allowed ? null : new Error('Origin not allowed'), allowed);
  } catch {
    callback(new Error('Invalid origin'), false);
  }
}

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: isAllowedOrigin }));
  app.use(express.json({ limit: '64kb' }));

  // ภาพที่ผู้ใช้อัปโหลดต้องมาก่อน static ของ public
  // URL ยังเป็น /images/team-logos/... กับ /images/skins/... เหมือนเดิม
  // หน้าเว็บจึงไม่ต้องรู้ว่าไฟล์จริงย้ายออกไปนอก asar แล้ว
  app.use('/images/team-logos', express.static(path.join(USER_MEDIA_DIR, 'team-logos')));
  app.use('/images/skins', express.static(path.join(USER_MEDIA_DIR, 'skins')));

  app.use(express.static(PUBLIC_DIR));

  app.use(pageRoutes());
  app.use(stateRoutes());
  app.use(mediaRoutes());
  app.use(tournamentRoutes());
  app.use(teamRoutes());

  return app;
}

export function createServer(): {
  app: Express;
  server: http.Server;
  io: SocketServer;
} {
  const app = createApp();
  const server = http.createServer(app);

  const io = new SocketServer(server, {
    cors: {
      origin: isAllowedOrigin,
      methods: ['GET', 'POST']
    }
  });

  attachIo(io);
  io.on('connection', registerHandlers);

  // ต้องเกาะก่อนรับคำสั่งแรก ไม่งั้นดราฟต์ช่วงต้นของเกมแรกจะไม่ถูกบันทึก
  // และเกมที่ดราฟต์ไปแล้วก่อนตัวบันทึกจะมี กู้คืนไม่ได้เลย
  attachDraftCapture();

  return { app, server, io };
}

export function start(
  options: { port?: number; host?: string } = {}
): { server: http.Server; io: SocketServer } {
  const port = options.port ?? PORT;
  const host = options.host ?? HOST;
  const { server, io } = createServer();

  server.listen(port, host, () => {
    console.log('===========================================');
    console.log('ROV Overlay Tool Server Running');
    console.log('===========================================');
    console.log(`Home: http://${host}:${port}`);
    console.log(`Control Panel: http://${host}:${port}/control`);
    console.log(`Overlay 1920x1080: http://${host}:${port}/overlay`);
    console.log(`Overlay 2560x1440: http://${host}:${port}/overlay-1440`);
    console.log(`Result: http://${host}:${port}/result`);
    console.log('===========================================');
    if (CONTROL_TOKEN) {
      console.log('Control token protection is enabled.');
    }
  });

  return { server, io };
}
