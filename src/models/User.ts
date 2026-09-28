import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';
import dns from 'dns'; // Нативный модуль Node.js

dotenv.config();

const sequelize = new Sequelize(process.env.DB_NAME!, process.env.DB_USER!, process.env.DB_PASS!, {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false,
    dialectOptions: {
        // Добавляем явную типизацию для параметров DNS-лукапа
        lookup: (
            hostname: string, 
            options: dns.LookupOneOptions, 
            callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
        ) => {
            dns.lookup(hostname, { family: 6 }, callback);
        }
    }
});

export class User extends Model {
    public id!: number;
    public tgId!: number;
    public role!: 'admin' | 'user' | 'pending';
    public username!: string;
}

User.init({
    tgId: { type: DataTypes.BIGINT, unique: true, allowNull: false },
    username: { type: DataTypes.STRING },
    role: { type: DataTypes.ENUM('admin', 'user', 'pending'), defaultValue: 'pending' }
}, { sequelize, modelName: 'user' });

export { sequelize };
