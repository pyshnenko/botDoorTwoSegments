import { DataTypes, Model } from 'sequelize';
import { sequelize } from './User';

export class Log extends Model {
    public id!: number;
    public tgId!: number;
    public username!: string;
    public action!: string;
    // Явно указываем системные поля для TypeScript
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

Log.init({
    tgId: { type: DataTypes.BIGINT, allowNull: false },
    username: { type: DataTypes.STRING },
    action: { type: DataTypes.STRING, allowNull: false }
}, { 
    sequelize, 
    modelName: 'log',
    timestamps: true // Убеждаемся, что поля включены
});
