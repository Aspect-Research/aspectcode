import { UserService } from './services/UserService';
import { formatDate } from './utils/format';

export class App {
  private userService: UserService;

  constructor() {
    this.userService = new UserService();
  }

  run(): void {
    const users = this.userService.getAll();
    for (const user of users) {
      console.log(`${user.name} — joined ${formatDate(user.joinedAt)}`);
    }
  }
}
