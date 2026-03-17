import db from './db.js';

const teams = db.prepare('SELECT * FROM teams').all();
const competitions = db.prepare('SELECT * FROM competitions').all();
const matches = db.prepare('SELECT * FROM matches').all();

console.log('Teams:', teams);
console.log('Competitions:', competitions);
console.log('Matches:', matches);
