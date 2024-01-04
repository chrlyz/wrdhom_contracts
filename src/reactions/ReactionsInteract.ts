import {
  Mina,
  PrivateKey,
  Field,
  MerkleMap,
  Poseidon,
  fetchLastBlock,
} from 'o1js';
import fs from 'fs/promises';
import { PostState } from '../posts/Posts.js';
import { ReactionsTransition, Reactions } from './Reactions.js';
import { ReactionsContract } from './ReactionsContract.js';
import { Config } from '../posts/PostsDeploy.js';
import { createReactionTransitionValidInputs } from './ReactionsUtils.js';

const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const postsConfig = configJson.deployAliases['posts'];
const postsContractKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(postsConfig.keyPath, 'utf8'));
const postsContractKey = PrivateKey.fromBase58(
  postsContractKeysBase58.privateKey
);
const postsContractAddress = postsContractKey.toPublicKey();
const postsContractAddressAsField = Poseidon.hash(
  postsContractAddress.toFields()
);

const reactionsConfig = configJson.deployAliases['reactions'];
const feePayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(reactionsConfig.feepayerKeyPath, 'utf8'));

const reactionsContractKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(reactionsConfig.keyPath, 'utf8'));

const feePayerKey = PrivateKey.fromBase58(feePayerKeysBase58.privateKey);
const reactionsContractKey = PrivateKey.fromBase58(
  reactionsContractKeysBase58.privateKey
);

const Network = Mina.Network(reactionsConfig.url);
const fee = Number(reactionsConfig.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
Mina.setActiveInstance(Network);
const feePayerAddress = feePayerKey.toPublicKey();
const feePayerAddressAsField = Poseidon.hash(feePayerAddress.toFields());
const reactionsContractAddress = reactionsContractKey.toPublicKey();
const reactionsContract = new ReactionsContract(reactionsContractAddress);
const reactionsContractAddressAsField = Poseidon.hash(
  reactionsContractAddress.toFields()
);

console.log('Compiling Reactions zkProgram...');
await Reactions.compile();
console.log('Compiling ReactionsContract...');
await ReactionsContract.compile();
console.log('Compiled');

const postsMap = new MerkleMap();
const usersReactionsCountersMap = new MerkleMap();
const targetsReactionsCountersMap = new MerkleMap();
const reactionsMap = new MerkleMap();

// ==============================================================================
// 1. Publishes on-chain proof for reaction to 2nd post
// ==============================================================================

// Restore PostState for posts after transaction 3
const post1 = PostState.fromJSON(
  JSON.parse(await fs.readFile('./build/src/post1.json', 'utf8'))
) as PostState;
const post2 = PostState.fromJSON(
  JSON.parse(await fs.readFile('./build/src/post2.json', 'utf8'))
) as PostState;
const post3 = PostState.fromJSON(
  JSON.parse(await fs.readFile('./build/src/post3.json', 'utf8'))
) as PostState;

// Restore MerkleMap produced in previous transactions
postsMap.set(
  Poseidon.hash([feePayerAddressAsField, post1.postContentID.hash()]),
  post1.hash()
);
postsMap.set(
  Poseidon.hash([feePayerAddressAsField, post2.postContentID.hash()]),
  post2.hash()
);
postsMap.set(
  Poseidon.hash([postsContractAddressAsField, post3.postContentID.hash()]),
  post3.hash()
);

// Get last block to target next block to timestamp our post state
const lastBlock1 = await fetchLastBlock(postsConfig.url);

// Prepare inputs to create a valid state transition
const valid1 = createReactionTransitionValidInputs(
  post2,
  feePayerAddress,
  feePayerKey,
  Field(10084),
  Field(1),
  Field(1),
  Field(1),
  Field(lastBlock1.blockchainLength.toBigint()),
  postsMap,
  usersReactionsCountersMap,
  targetsReactionsCountersMap,
  reactionsMap
);

// Create a valid state transition
const transition1 = ReactionsTransition.createReactionPublishingTransition(
  valid1.signature,
  postsMap.getRoot(),
  valid1.targetState,
  valid1.targetWitness,
  valid1.reactionState.allReactionsCounter.sub(1),
  valid1.initialUsersReactionsCounters,
  valid1.latestUsersReactionsCounters,
  valid1.reactionState.userReactionsCounter.sub(1),
  valid1.userReactionsCounterWitness,
  valid1.initialTargetsReactionsCounters,
  valid1.latestTargetsReactionsCounters,
  valid1.reactionState.targetReactionsCounter.sub(1),
  valid1.targetReactionsCounterWitness,
  valid1.initialReactions,
  valid1.latestReactions,
  valid1.reactionWitness,
  valid1.reactionState
);

// Create valid proof for our state transition
const proof1 = await Reactions.proveReactionPublishingTransition(
  transition1,
  valid1.signature,
  postsMap.getRoot(),
  valid1.targetState,
  valid1.targetWitness,
  valid1.reactionState.allReactionsCounter.sub(1),
  valid1.initialUsersReactionsCounters,
  valid1.latestUsersReactionsCounters,
  valid1.reactionState.userReactionsCounter.sub(1),
  valid1.userReactionsCounterWitness,
  valid1.initialTargetsReactionsCounters,
  valid1.latestTargetsReactionsCounters,
  valid1.reactionState.targetReactionsCounter.sub(1),
  valid1.targetReactionsCounterWitness,
  valid1.initialReactions,
  valid1.latestReactions,
  valid1.reactionWitness,
  valid1.reactionState
);

// Send valid proof to update our on-chain state
let sentTxn1;
try {
  const txn1 = await Mina.transaction(
    { sender: feePayerAddress, fee: fee },
    () => {
      reactionsContract.update(proof1);
    }
  );
  await txn1.prove();
  sentTxn1 = await txn1.sign([feePayerKey]).send();
} catch (err) {
  console.log(err);
}
if (sentTxn1?.hash() !== undefined) {
  console.log(`
Success! Roots of merkle maps to prove publication
of reaction to 2nd post have been sent to be published on-chain.

Your smart contract state will be updated
as soon as the transaction is included in a block:
https://berkeley.minaexplorer.com/transaction/${sentTxn1.hash()}

If the transaction fails, execute this step again. The transaction
probably took too long to be included in a block, so the block height
associated to the post deletion or publication is no longer valid
(block length is used as a way to timestamp at which point a reaction was
made).
`);

  const reaction1JSON = JSON.stringify(valid1.reactionState);
  await fs.writeFile('./build/src/reaction1.json', reaction1JSON, 'utf-8');
}
