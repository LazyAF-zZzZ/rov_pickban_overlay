// ประกอบทุกส่วนเข้าด้วยกันแล้วเปิดเซิร์ฟเวอร์
//
// ลำดับใน createApp สำคัญ: static ของภาพที่ผู้ใช้อัปโหลดต้องมาก่อน
// express.static(PUBLIC_DIR) ไม่งั้นภาพเดิมที่อยู่ใน asar จะบังภาพใหม่

import path from 'path';
import http from 'http';
import express, { Express, Request, Response, NextFunction } from 'express';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';

import { PORT, HOST, CONTROL_TOKEN, PUBLIC_DIR, USER_MEDIA_DIR, USER_SOUND_DIR } from './config';
import { attachIo } from './store/live-state';
import { pageRoutes } from './http/pages';
import { ensureSoundDir } from './domain/media';
import { stateRoutes } from './http/api-state';
import { mediaRoutes } from './http/api-media';
import { tournamentRoutes } from './http/api-tournaments';
import { teamRoutes } from './http/api-teams';
import { hotkeyRoutes } from './http/api-hotkeys';
import { backupRoutes } from './http/api-backup';
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

  // ต้องมาก่อนตัวแยกวิเคราะห์ JSON กลาง
  //
  // ตัวกลางจำกัดที่ 64kb ซึ่งพอดีกับทุก API ที่มีอยู่ แต่ไฟล์สำรองมีรูปฝังมาด้วย
  // ถ้าปล่อยให้ตัวกลางเจอก่อน มันจะปฏิเสธไปตั้งแต่ต้นทางโดยที่เราเตอร์ไม่ได้เห็นเลย
  // body-parser ตัวหลังจะข้ามไปเองเมื่อ body ถูกแยกวิเคราะห์ไปแล้ว
  app.use(backupRoutes());

  app.use(express.json({ limit: '64kb' }));

  // nosniff กับภาพที่ผู้ใช้เอาเข้ามา
  //
  // ไฟล์พวกนี้มาจากการอัปโหลดและจากไฟล์สำรองที่อาจมาจากคนอื่น
  // ทั้งสองทางตรวจไบต์ต้นไฟล์แล้ว แต่ nosniff เป็นด่านที่ไม่ต้องเชื่อการตรวจนั้น:
  // ต่อให้มีอะไรหลุดเข้ามาเป็น HTML เบราว์เซอร์ก็จะไม่เดาชนิดแล้วรันมันในต้นทาง
  // เดียวกับหน้าคุมงาน ซึ่งเป็นต้นทางที่ถือโทเคนควบคุม overlay อยู่
  const noSniff = (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  };

  // ภาพที่ผู้ใช้อัปโหลดต้องมาก่อน static ของ public
  // URL ยังเป็น /images/team-logos/... กับ /images/skins/... เหมือนเดิม
  // หน้าเว็บจึงไม่ต้องรู้ว่าไฟล์จริงย้ายออกไปนอก asar แล้ว
  app.use('/images/team-logos', noSniff, express.static(path.join(USER_MEDIA_DIR, 'team-logos')));
  app.use('/images/skins', noSniff, express.static(path.join(USER_MEDIA_DIR, 'skins')));
  // เสียงเอฟเฟกต์ของ overlay ไม่มีก็ไม่เป็นไร express.static บนโฟลเดอร์ที่ยังไม่มี
  // จะปล่อยผ่านไป 404 เฉยๆ ไม่ได้ทำให้เซิร์ฟเวอร์พัง
  app.use('/sounds', express.static(USER_SOUND_DIR));

  app.use(express.static(PUBLIC_DIR));

  app.use(pageRoutes());
  app.use(stateRoutes());
  app.use(mediaRoutes());
  app.use(tournamentRoutes());
  app.use(teamRoutes());
  app.use(hotkeyRoutes());

  // ตัวจับ error ตัวสุดท้าย ต้องมาหลัง route ทั้งหมด และต้องรับสี่พารามิเตอร์
  // ไม่งั้น express จะนับมันเป็น middleware ธรรมดา ไม่ใช่ตัวจับ error
  //
  // ที่ต้องมี: ทุก endpoint ในแอพนี้ตอบเป็น JSON รูป { error } และฝั่งหน้าเว็บ
  // อ่านผ่าน fetchJson ซึ่งทำ response.json() แล้วหยิบ data.error มาโชว์
  // ส่วน body ที่ไม่ใช่ JSON จะถูก express.json() ปฏิเสธก่อนถึง route
  // แล้วตกไปที่ตัวจับ error ปริยายของ express ซึ่งตอบเป็น "HTML" พร้อม stack trace
  //
  // ผลสองอย่าง: หน้าเว็บได้ข้อความ "Bad Request" ลอยๆ แทนเหตุผลจริง
  // และเนื้อหาที่ตอบกลับมี path เต็มของเครื่องที่รันอยู่ ซึ่งไม่ควรออกไปทางสายไฟ
  // แม้ค่าเริ่มต้นจะผูกที่ 127.0.0.1 แต่ HOST ตั้งทับได้จาก env
  app.use((err: Error & { status?: number; statusCode?: number },
    _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      error: status === 400 ? 'That request body could not be read' : 'Something went wrong'
    });
  });

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

  // โฟลเดอร์เสียงต้องมีอยู่ก่อนที่ผู้ใช้จะไปหา และต้องบอกที่อยู่เต็มๆ ด้วย
  // มันอยู่คนละที่กันระหว่างรันจาก source กับรันจาก .exe ที่ติดตั้งแล้ว
  const soundDir = ensureSoundDir();

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
    console.log('Sound effects (optional): put pick.mp3 / ban.mp3 / timer-warning.mp3 in');
    console.log(`  ${soundDir}`);
    console.log(`then use  http://${host}:${port}/overlay?sfx=1  as the browser source URL`);
    console.log('===========================================');
    if (CONTROL_TOKEN) {
      console.log('Control token protection is enabled.');
    }
  });

  return { server, io };
}
