#!/usr/bin/env node
import process from 'node:process';

process.env.VALIDATION_RESULT = String(process.env.VALIDATION_RESULT || '').toUpperCase();
await import('./record-stage7-validation.mjs');
