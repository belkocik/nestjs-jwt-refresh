import { ApiProperty } from '@nestjs/swagger';

export class UserIdDto {
  @ApiProperty()
  containsUserId?: string;
}
