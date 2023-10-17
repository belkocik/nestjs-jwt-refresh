import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthDto } from './dto';
import * as bcrypt from 'bcrypt';
import { Tokens } from './types';
import { JwtService } from '@nestjs/jwt';
import { I18nService } from 'nestjs-i18n';
import { UserIdDto } from './dto/user-id.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly i18n: I18nService,
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signupLocal(dto: AuthDto): Promise<Tokens> {
    const hash = await this.hashData(dto.password);
    try {
      const newUser = await this.prisma.user.create({
        data: {
          email: dto.email,
          hash,
        },
      });

      const tokens = await this.getTokens(newUser.id, newUser.email);
      await this.updateRtHash(newUser.id, tokens.refresh_token);
      return tokens;
    } catch (error) {
      const { code: prismaErrorCode } = error;
      //? "Unique constraint failed on the {constraint}"
      if (prismaErrorCode === 'P2002') {
        throw new HttpException(
          this.i18n.t('exceptions.emailMustBeUnique'),
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      //? in case of the other errors
      throw new HttpException(
        this.i18n.t('exceptions.internalServerErrorBaseMsg'),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async signinLocal(dto: AuthDto, userIdDto: UserIdDto): Promise<Tokens> {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
    });

    if (!user)
      throw new ForbiddenException(this.i18n.t('exceptions.accessDeniedMsg'));

    const passwordMatches = await bcrypt.compare(dto.password, user.hash);
    if (!passwordMatches)
      throw new ForbiddenException(this.i18n.t('exceptions.accessDeniedMsg'));

    const tokens = await this.getTokens(user.id, user.email);
    await this.updateRtHash(user.id, tokens.refresh_token);

    if (userIdDto.containsUserId === 'true') {
      return {
        ...tokens,
        user_id: user.id,
      };
    }

    return tokens;
  }
  async logout(userId: number) {
    //? get the user by userID only if the hashedRT is NOT null and set it to null
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        hashedRt: {
          not: null,
        },
      },
      data: {
        hashedRt: null,
      },
    });
  }
  async refreshTokens(userId: number, rt: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user)
      throw new ForbiddenException(this.i18n.t('exceptions.accessDeniedMsg'));

    const rtMatches = bcrypt.compare(rt, user.hashedRt);
    if (!rtMatches)
      throw new ForbiddenException(this.i18n.t('exceptions.accessDeniedMsg'));

    const tokens = await this.getTokens(user.id, user.email);
    await this.updateRtHash(user.id, tokens.refresh_token);
    return tokens;
  }

  async updateRtHash(userId: number, rt: string) {
    const hash = await this.hashData(rt);
    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        hashedRt: hash,
      },
    });
  }

  hashData(data: string) {
    return bcrypt.hash(data, 10);
  }

  async getTokens(userId: number, email: string) {
    const [at, rt] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
        },
        {
          secret: 'at-secret',
          expiresIn: 60 * 15, // 15 minutes
        },
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          email,
        },
        {
          secret: 'rt-secret',
          expiresIn: 60 * 60 * 24 * 7, // 7 days
        },
      ),
    ]);

    return {
      access_token: at,
      refresh_token: rt,
    };
  }
}
