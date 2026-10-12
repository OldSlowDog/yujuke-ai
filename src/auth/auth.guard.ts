import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * 白名单鉴权守卫：网页端经 nginx 反代，用户身份由受信网关注入请求头 `x-user`。
 * 仅白名单内的用户可建立会话；内部服务间调用另走 `X-Internal-Key` 共享密钥。
 * 注意：生产环境 `x-user` 必须由网关基于真实会话签发，不可由客户端伪造。
 */
@Injectable()
export class WhitelistGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.headers['x-user'] ?? req.query?.user;
    const whitelist = (process.env.API_AUTH_WHITELIST ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    if (user && whitelist.includes(user)) {
      req.userId = user;
      return true;
    }
    throw new UnauthorizedException('user not in whitelist');
  }
}
