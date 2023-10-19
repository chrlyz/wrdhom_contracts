import {
  Mina,
  PrivateKey,
  PublicKey,
  CircuitString,
  Field,
  Signature,
  MerkleMap,
  Poseidon,
  fetchLastBlock,
} from 'o1js';
import fs from 'fs/promises';
import { PostState, PostsTransition, Posts } from './Posts.js';
import { PostsContract } from './PostsContract.js';

const deployAlias = process.argv[2];
if (!deployAlias)
  throw Error(`Missing <deployAlias> argument.

Usage:
node build/src/interact.js <deployAlias>
`);
Error.stackTraceLimit = 1000;

type Config = {
  deployAliases: Record<
    string,
    {
      url: string;
      keyPath: string;
      fee: string;
      feepayerKeyPath: string;
      feepayerAlias: string;
    }
  >;
};
const configJson: Config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const config = configJson.deployAliases[deployAlias];
const feepayerKeysBase58: { privateKey: string; publicKey: string } =
  JSON.parse(await fs.readFile(config.feepayerKeyPath, 'utf8'));

const zkAppKeysBase58: { privateKey: string; publicKey: string } = JSON.parse(
  await fs.readFile(config.keyPath, 'utf8')
);

const feepayerKey = PrivateKey.fromBase58(feepayerKeysBase58.privateKey);
const zkAppKey = PrivateKey.fromBase58(zkAppKeysBase58.privateKey);

const Network = Mina.Network(config.url);
const fee = Number(config.fee) * 1e9; // in nanomina (1 billion = 1.0 mina)
Mina.setActiveInstance(Network);
const feepayerAddress = feepayerKey.toPublicKey();
const zkAppAddress = zkAppKey.toPublicKey();
const zkApp = new PostsContract(zkAppAddress);

console.log('Compiling Posts zkProgram...');
await Posts.compile();
console.log('Compiling PostsContract...');
await PostsContract.compile();
console.log('Compiled');

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();

const lastBlock = await fetchLastBlock(config.url);

const valid1 = createPostPublishingTransitionValidInputs(
  feepayerAddress,
  feepayerKey,
  CircuitString.fromString(
    'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
  ),
  Field(1),
  Field(1),
  Field(lastBlock.blockchainLength.toBigint())
);

const transition1 = PostsTransition.createPostPublishingTransition(
  valid1.signature,
  valid1.postState.allPostsCounter.sub(1),
  valid1.initialUsersPostsCounters,
  valid1.latestUsersPostsCounters,
  valid1.postState.userPostsCounter.sub(1),
  valid1.userPostsCounterWitness,
  valid1.initialPosts,
  valid1.latestPosts,
  valid1.postState,
  valid1.postWitness
);

const proof1 = await Posts.provePostPublishingTransition(
  transition1,
  valid1.signature,
  valid1.postState.allPostsCounter.sub(1),
  valid1.initialUsersPostsCounters,
  valid1.latestUsersPostsCounters,
  valid1.postState.userPostsCounter.sub(1),
  valid1.userPostsCounterWitness,
  valid1.initialPosts,
  valid1.latestPosts,
  valid1.postState,
  valid1.postWitness
);

let sentTx;

try {
  const txn1 = await Mina.transaction(
    { sender: feepayerAddress, fee: fee },
    () => {
      zkApp.update(proof1);
    }
  );
  await txn1.prove();
  sentTx = await txn1.sign([feepayerKey]).send();
} catch (err) {
  console.log(err);
}
if (sentTx?.hash() !== undefined) {
  console.log(`
Success! Update transaction sent.

Your smart contract state will be updated
as soon as the transaction is included in a block:
https://berkeley.minaexplorer.com/transaction/${sentTx.hash()}
`);
}

function createPostPublishingTransitionValidInputs(
  posterAddress: PublicKey,
  posterKey: PrivateKey,
  postContentID: CircuitString,
  allPostsCounter: Field,
  userPostsCounter: Field,
  postingSlot: Field
) {
  const signature = Signature.create(posterKey, [postContentID.hash()]);

  const initialUsersPostsCounters = usersPostsCountersMap.getRoot();
  const posterAddressAsField = Poseidon.hash(posterAddress.toFields());
  const userPostsCounterWitness =
    usersPostsCountersMap.getWitness(posterAddressAsField);

  const initialPosts = postsMap.getRoot();
  const postKey = Poseidon.hash([posterAddressAsField, postContentID.hash()]);
  const postWitness = postsMap.getWitness(postKey);

  const postState = new PostState({
    posterAddress: posterAddress,
    postContentID: postContentID,
    allPostsCounter: allPostsCounter,
    userPostsCounter: userPostsCounter,
    postBlockHeight: postingSlot,
    deletionBlockHeight: Field(0),
  });

  usersPostsCountersMap.set(posterAddressAsField, userPostsCounter);
  const latestUsersPostsCounters = usersPostsCountersMap.getRoot();

  postsMap.set(postKey, postState.hash());
  const latestPosts = postsMap.getRoot();

  return {
    signature: signature,
    initialUsersPostsCounters: initialUsersPostsCounters,
    latestUsersPostsCounters: latestUsersPostsCounters,
    userPostsCounterWitness: userPostsCounterWitness,
    initialPosts: initialPosts,
    latestPosts: latestPosts,
    postState: postState,
    postWitness: postWitness,
  };
}
