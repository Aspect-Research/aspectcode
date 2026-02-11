export interface User {
  id: number;
  name: string;
  email: string;
  joinedAt: Date;
}

export class UserService {
  private users: User[] = [
    { id: 1, name: 'Alice', email: 'alice@example.com', joinedAt: new Date('2024-01-15') },
    { id: 2, name: 'Bob', email: 'bob@example.com', joinedAt: new Date('2024-03-22') },
  ];

  getAll(): User[] {
    return this.users;
  }

  getById(id: number): User | undefined {
    return this.users.find((u) => u.id === id);
  }
}
