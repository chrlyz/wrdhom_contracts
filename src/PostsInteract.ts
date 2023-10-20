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
import {
  PostState,
  PostsTransition,
  Posts,
  fieldToFlagPostsAsDeleted,
} from './Posts.js';
import { PostsContract } from './PostsContract.js';

const deployAlias = process.argv[2];
const numberOfTransaction = Number(process.argv[3]);
if (!deployAlias || !numberOfTransaction)
  throw Error(`Missing argument.

Usage:
node build/src/interact.js <deployAlias> <numberOfTransaction>
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
const feepayerAddressAsField = Poseidon.hash(feepayerAddress.toFields());
const zkAppAddress = zkAppKey.toPublicKey();
const zkApp = new PostsContract(zkAppAddress);

console.log('Compiling Posts zkProgram...');
await Posts.compile();
console.log('Compiling PostsContract...');
await PostsContract.compile();
console.log('Compiled');

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();

if (numberOfTransaction === 1) {
  const lastBlock1 = await fetchLastBlock(config.url);

  const valid1 = createPostPublishingTransitionValidInputs(
    feepayerAddress,
    feepayerKey,
    CircuitString.fromString(
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    ),
    Field(1),
    Field(1),
    Field(lastBlock1.blockchainLength.toBigint())
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

  let sentTxn1;

  try {
    const txn1 = await Mina.transaction(
      { sender: feepayerAddress, fee: fee },
      () => {
        zkApp.update(proof1);
      }
    );
    await txn1.prove();
    sentTxn1 = await txn1.sign([feepayerKey]).send();
  } catch (err) {
    console.log(err);
  }
  if (sentTxn1?.hash() !== undefined) {
    console.log(`
  Success! Root of MekleMap containing proof
  for first post has been published on-chain.

  Your smart contract state will be updated
  as soon as the transaction is included in a block:
  https://berkeley.minaexplorer.com/transaction/${sentTxn1.hash()}
  `);

    const post1JSON = JSON.stringify(valid1.postState);
    await fs.writeFile('./build/src/post1.json', post1JSON, 'utf-8');
  }
}

if (numberOfTransaction === 2) {
  const post1: PostState = JSON.parse(
    await fs.readFile('./build/src/post1.json', 'utf8')
  );

  // Restore PostState for post1 produced in transaction 1
  const post1Restored = new PostState({
    posterAddress: feepayerAddress,
    postContentID: CircuitString.fromString(
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    ),
    allPostsCounter: Field(post1.allPostsCounter),
    userPostsCounter: Field(post1.userPostsCounter),
    postBlockHeight: Field(post1.postBlockHeight),
    deletionBlockHeight: Field(post1.deletionBlockHeight),
  });

  // Restore MerkleMap produced in transaction 1
  usersPostsCountersMap.set(
    feepayerAddressAsField,
    Field(post1Restored.userPostsCounter)
  );
  postsMap.set(
    Poseidon.hash([feepayerAddressAsField, post1Restored.postContentID.hash()]),
    post1Restored.hash()
  );

  const lastBlock2 = await fetchLastBlock(config.url);

  const valid2 = createPostDeletionTransitionValidInputs(
    feepayerKey,
    Field(1),
    post1Restored,
    Field(lastBlock2.blockchainLength.toBigint())
  );

  const transition2 = PostsTransition.createPostDeletionTransition(
    valid2.signature,
    valid2.allPostsCounter,
    valid2.usersPostsCounters,
    valid2.initialPosts,
    valid2.latestPosts,
    valid2.initialPostState,
    valid2.postWitness,
    valid2.latestPostState.deletionBlockHeight
  );

  const proof2 = await Posts.provePostDeletionTransition(
    transition2,
    valid2.signature,
    valid2.allPostsCounter,
    valid2.usersPostsCounters,
    valid2.initialPosts,
    valid2.latestPosts,
    valid2.initialPostState,
    valid2.postWitness,
    valid2.latestPostState.deletionBlockHeight
  );

  let sentTxn2;

  try {
    const txn2 = await Mina.transaction(
      { sender: feepayerAddress, fee: fee },
      () => {
        zkApp.update(proof2);
      }
    );
    await txn2.prove();
    sentTxn2 = await txn2.sign([feepayerKey]).send();
  } catch (err) {
    console.log(err);
  }
  if (sentTxn2?.hash() !== undefined) {
    console.log(`
  Success! Root of MekleMap containing proof
  for deletion of first post has been published on-chain.
  
  Your smart contract state will be updated
  as soon as the transaction is included in a block:
  https://berkeley.minaexplorer.com/transaction/${sentTxn2.hash()}
  `);

    const post1JSON = JSON.stringify(valid2.latestPostState);
    await fs.writeFile('./build/src/post1.json', post1JSON, 'utf-8');
  }
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

function createPostDeletionTransitionValidInputs(
  posterKey: PrivateKey,
  allPostsCounter: Field,
  initialPostState: PostState,
  deletionBlockHeight: Field
) {
  const postStateHash = initialPostState.hash();
  const signature = Signature.create(posterKey, [
    postStateHash,
    fieldToFlagPostsAsDeleted,
  ]);

  const usersPostsCounters = usersPostsCountersMap.getRoot();

  const posterAddressAsField = Poseidon.hash(
    initialPostState.posterAddress.toFields()
  );
  const initialPosts = postsMap.getRoot();
  const postKey = Poseidon.hash([
    posterAddressAsField,
    initialPostState.postContentID.hash(),
  ]);
  const postWitness = postsMap.getWitness(postKey);

  const latestPostState = new PostState({
    posterAddress: initialPostState.posterAddress,
    postContentID: initialPostState.postContentID,
    allPostsCounter: initialPostState.allPostsCounter,
    userPostsCounter: initialPostState.userPostsCounter,
    postBlockHeight: initialPostState.postBlockHeight,
    deletionBlockHeight: deletionBlockHeight,
  });

  postsMap.set(postKey, latestPostState.hash());
  const latestPosts = postsMap.getRoot();

  return {
    signature: signature,
    allPostsCounter: allPostsCounter,
    usersPostsCounters: usersPostsCounters,
    initialPosts: initialPosts,
    latestPosts: latestPosts,
    initialPostState: initialPostState,
    latestPostState: latestPostState,
    postWitness: postWitness,
  };
}
