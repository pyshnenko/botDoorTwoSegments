import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const sequelize = new Sequelize(process.env.DB_NAME!, process.env.DB_USER!, process.env.DB_PASS!, {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false
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
