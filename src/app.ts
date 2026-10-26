import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { authRoutes } from './routes/auth';
import { notFound, errorHandler } from './middleware/errorHandler';
import { StatusCode } from './constants/statusCode';

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

// Liveness probe.
app.get('/health', (req, res) => {
  res.status(StatusCode.OK).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);

app.use(notFound);
app.use(errorHandler);
