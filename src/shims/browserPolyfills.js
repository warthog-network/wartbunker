/**
 * Browser polyfills for warthog-js / crypto-browserify dependency chain.
 * Must run before any wallet signing code loads (see Layout.astro).
 */
import process from './process.js';
import { Buffer } from 'buffer';

globalThis.global = globalThis;
globalThis.process = process;
globalThis.Buffer = Buffer;