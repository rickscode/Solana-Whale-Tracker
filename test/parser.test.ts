// Regression tests for the swap parser.
// The synthetic cases cover the shapes that have caused real bugs; the
// fixtures are genuine transactions pulled from the chain.
// Run with: npm test

import { parseSolanaSwap } from '../src/services/parser';
import { HeliusTransaction } from '../src/types';
import * as fs from 'fs';

const W='4UrFSCrGxgoCtCUBAEZq7ZmPK3Pczkxx7PwYnkBMi1KR';
const A='5MztePcdvyzJr4Dd1Wj15scXEeddst1sMp759aNWf7gm';
const WSOL='So11111111111111111111111111111111111111112';
const BONK='DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const PEPE='PePeXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const base={signature:'s',timestamp:1,transactionError:null,nativeTransfers:[]};
const near=(a:number,b:number,tol=1e-6)=>Math.abs(a-b)<tol;
let failed=0;
const check=(n:string,ok:boolean,got:unknown,want:string)=>{
  if(ok) console.log(`  ok   ${n}`);
  else {failed++;console.log(`  FAIL ${n}\n       want ${want}\n       got  ${JSON.stringify(got)}`);}
};
const tt=(from:string,to:string,mint:string,amt:number)=>({fromUserAccount:from,toUserAccount:to,mint,tokenAmount:amt});

let r=parseSolanaSwap({...base,type:'SWAP',source:'PUMP_FUN',tokenTransfers:[
  tt('pool',W,BONK,1e6), tt(W,'pool',WSOL,2.5)]} as HeliusTransaction,W);
check('buy paid in wrapped SOL', !!r&&r.side==='buy'&&near(r.quoteNative,2.5)&&r.quoteUsd===0&&r.nativeSymbol==='SOL', r,'sol 2.5');

r=parseSolanaSwap({...base,type:'SWAP',source:'RAYDIUM',tokenTransfers:[
  tt(W,'pool',BONK,500), tt('pool',W,USDC,123.45)]} as HeliusTransaction,W);
check('sell received USDC', !!r&&r.side==='sell'&&near(r.quoteUsd,123.45), r,'usd 123.45');

r=parseSolanaSwap({...base,type:'SWAP',source:'JUPITER',tokenTransfers:[
  tt(W,'pA',WSOL,4), tt('pA','pB',WSOL,999), tt('pB',W,BONK,42)]} as HeliusTransaction,W);
check('router legs excluded', !!r&&near(r.quoteNative,4), r,'sol 4 not 999');

r=parseSolanaSwap({...base,type:'SWAP',source:'PUMP_FUN',
  nativeTransfers:[{fromUserAccount:W,toUserAccount:'p',amount:1.5e9}],
  tokenTransfers:[tt('p',W,BONK,7)]} as HeliusTransaction,W);
check('native SOL fallback', !!r&&near(r.quoteNative,1.5), r,'sol 1.5');

r=parseSolanaSwap({...base,type:'SWAP',source:'JUPITER',tokenTransfers:[
  tt('p',W,BONK,10), tt(W,'p',USDC,100), tt(W,'p',USDC,250),
  tt(W,'p',WSOL,5), tt('p',W,WSOL,5)]} as HeliusTransaction,W);
check('split quote legs summed, wrap cancels', !!r&&near(r.quoteUsd,350)&&near(r.quoteNative,0), r,'usd 350 sol 0');

// the regression: token arriving in several tranches
r=parseSolanaSwap({...base,type:'SWAP',source:'JUPITER',tokenTransfers:[
  tt('p',W,BONK,600000), tt('p',W,BONK,2100000), tt(W,'p',USDC,7000)]} as HeliusTransaction,W);
check('multi-tranche token summed', !!r&&near(r.tokenAmount,2700000,0.01), r,'2,700,000 tokens');

// an intermediate token that arrives and leaves must not become the trade
r=parseSolanaSwap({...base,type:'SWAP',source:'JUPITER',tokenTransfers:[
  tt('p',W,PEPE,999999), tt(W,'p',PEPE,999999), tt('p',W,BONK,42), tt(W,'p',USDC,10)]} as HeliusTransaction,W);
check('pass-through token ignored', !!r&&r.tokenAddress===BONK&&near(r.tokenAmount,42), r,'BONK 42');

// dust residue is not a trade
r=parseSolanaSwap({...base,type:'SWAP',source:'x',tokenTransfers:[
  tt('p',W,BONK,1e-12), tt(W,'p',USDC,5)]} as HeliusTransaction,W);
check('dust residue rejected', r===null, r,'null');

for(const [n,tx] of [['failed tx',{...base,type:'SWAP',source:'x',transactionError:{e:1},tokenTransfers:[]}],
                     ['non-swap',{...base,type:'TRANSFER',source:'x',tokenTransfers:[]}],
                     ['not our wallet',{...base,type:'SWAP',source:'x',tokenTransfers:[tt('a','b',BONK,1)]}]] as [string,HeliusTransaction][])
  check(n+' rejected', parseSolanaSwap(tx,W)===null, null,'null');

// real transactions from the chain
const axe=JSON.parse(fs.readFileSync(`${__dirname}/fixtures/axe-nasduck.json`, 'utf-8'));
const want=[2908064.8719,2773400.7066];
axe.slice(0,2).forEach((raw:HeliusTransaction,i:number)=>{
  const s=parseSolanaSwap(raw,A);
  check(`REAL AXE Nasduck #${i+1}`, !!s&&near(s.tokenAmount,want[i],0.01)&&s.quoteUsd>6900, s, `${want[i]} tokens, ~$7000`);
});
const cc=JSON.parse(fs.readFileSync(`${__dirname}/fixtures/crimecat-buy.json`, 'utf-8'));
const s2=parseSolanaSwap(cc as HeliusTransaction,W);
check('REAL CRIMECAT buy', !!s2&&near(Math.round(s2.quoteUsd*100)/100,3333.57,0.01)&&Math.abs(s2.quoteNative)<1e-6, s2,'usd 3333.57');

console.log(failed?`\n${failed} FAILED`:'\nALL PASSED');
process.exit(failed?1:0);
