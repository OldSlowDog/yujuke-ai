import { Controller, Post, Body, Param, UseGuards, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WhitelistGuard } from '../auth/auth.guard';
import { ChatService } from './chat.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chat')
@UseGuards(WhitelistGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('sessions')
  createSession(@Req() req: { userId: string }, @Body() dto: CreateSessionDto) {
    return this.chat.createSession(req.userId, dto.title);
  }

  @Post('sessions/:id/messages')
  sendMessage(
    @Param('id') id: string,
    @Req() req: { userId: string },
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendMessage(req.userId, id, dto.content);
  }

  @Post('sessions/:id/messages/stream')
  streamMessage(
    @Param('id') id: string,
    @Req() req: { userId: string },
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ) {
    // 注意：注入 @Res 后由本方法自行结束响应（SSE 长连接）
    return this.chat.streamReply(id, dto.content, res);
  }
}
