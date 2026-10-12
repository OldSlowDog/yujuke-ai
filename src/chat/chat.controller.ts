import { Controller, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
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
}
