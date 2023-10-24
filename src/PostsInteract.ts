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
const zkAppAddressAsField = Poseidon.hash(zkAppAddress.toFields());

console.log('Compiling Posts zkProgram...');
await Posts.compile();
console.log('Compiling PostsContract...');
await PostsContract.compile();
console.log('Compiled');

const usersPostsCountersMap = new MerkleMap();
const postsMap = new MerkleMap();

// ==============================================================================
// 1. Publishes on-chain proof for publication of 1st post
// ==============================================================================

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
  Success! Roots of merkle maps to prove publication
  of 1st post have been sent to be published on-chain.

  Your smart contract state will be updated
  as soon as the transaction is included in a block:
  https://berkeley.minaexplorer.com/transaction/${sentTxn1.hash()}

  If the transaction fails, execute this step again. The transaction
  probably took too long to be included in a block, so the block height
  associated to the post deletion or publication is no longer valid
  (block length is used as a way to timestamp at which point a post was
  posted or deleted).
  `);

    const post1JSON = JSON.stringify(valid1.postState);
    await fs.writeFile('./build/src/post1.json', post1JSON, 'utf-8');
  }
}

// ==============================================================================
// 2. Publishes on-chain proof for deletion of 1st post
// ==============================================================================

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
  Success! Root of merkle map to prove deletion
  of 1st post has been sent to be updated on-chain.
  
  Your smart contract state will be updated
  as soon as the transaction is included in a block:
  https://berkeley.minaexplorer.com/transaction/${sentTxn2.hash()}

  If the transaction fails, execute this step again. The transaction
  probably took too long to be included in a block, so the block height
  associated to the post deletion or publication is no longer valid
  (block length is used as a way to timestamp at which point a post was
  posted or deleted).
  `);

    const post1JSON = JSON.stringify(valid2.latestPostState);
    await fs.writeFile('./build/src/post1.json', post1JSON, 'utf-8');
  }
}

// ==============================================================================
// 3. Publishes on-chain proof for publication of 2nd and 3rd posts
// ==============================================================================

if (numberOfTransaction === 3) {
  const post1: PostState = JSON.parse(
    await fs.readFile('./build/src/post1.json', 'utf8')
  );

  // Restore PostState for post1 produced in transaction 2
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

  // Restore MerkleMap produced in transaction 2
  usersPostsCountersMap.set(
    feepayerAddressAsField,
    Field(post1Restored.userPostsCounter)
  );
  postsMap.set(
    Poseidon.hash([feepayerAddressAsField, post1Restored.postContentID.hash()]),
    post1Restored.hash()
  );

  const lastBlock3 = await fetchLastBlock(config.url);

  const valid3 = createPostPublishingTransitionValidInputs(
    feepayerAddress,
    feepayerKey,
    CircuitString.fromString(
      'b3333333333333333333333333333333333333333333333333333333333'
    ),
    Field(2),
    Field(2),
    Field(lastBlock3.blockchainLength.toBigint())
  );

  const transition3 = PostsTransition.createPostPublishingTransition(
    valid3.signature,
    valid3.postState.allPostsCounter.sub(1),
    valid3.initialUsersPostsCounters,
    valid3.latestUsersPostsCounters,
    valid3.postState.userPostsCounter.sub(1),
    valid3.userPostsCounterWitness,
    valid3.initialPosts,
    valid3.latestPosts,
    valid3.postState,
    valid3.postWitness
  );

  const proof3 = await Posts.provePostPublishingTransition(
    transition3,
    valid3.signature,
    valid3.postState.allPostsCounter.sub(1),
    valid3.initialUsersPostsCounters,
    valid3.latestUsersPostsCounters,
    valid3.postState.userPostsCounter.sub(1),
    valid3.userPostsCounterWitness,
    valid3.initialPosts,
    valid3.latestPosts,
    valid3.postState,
    valid3.postWitness
  );

  const valid4 = createPostPublishingTransitionValidInputs(
    zkAppAddress,
    zkAppKey,
    CircuitString.fromString(
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    ),
    Field(3),
    Field(1),
    Field(lastBlock3.blockchainLength.toBigint())
  );

  const transition4 = PostsTransition.createPostPublishingTransition(
    valid4.signature,
    valid4.postState.allPostsCounter.sub(1),
    valid4.initialUsersPostsCounters,
    valid4.latestUsersPostsCounters,
    valid4.postState.userPostsCounter.sub(1),
    valid4.userPostsCounterWitness,
    valid4.initialPosts,
    valid4.latestPosts,
    valid4.postState,
    valid4.postWitness
  );

  const proof4 = await Posts.provePostPublishingTransition(
    transition4,
    valid4.signature,
    valid4.postState.allPostsCounter.sub(1),
    valid4.initialUsersPostsCounters,
    valid4.latestUsersPostsCounters,
    valid4.postState.userPostsCounter.sub(1),
    valid4.userPostsCounterWitness,
    valid4.initialPosts,
    valid4.latestPosts,
    valid4.postState,
    valid4.postWitness
  );

  const mergedTransitions1 = PostsTransition.mergePostsTransitions(
    transition3,
    transition4
  );
  const mergedTransitionProofs1 = await Posts.proveMergedPostsTransitions(
    mergedTransitions1,
    proof3,
    proof4
  );

  let sentTxn3;

  try {
    const txn3 = await Mina.transaction(
      { sender: feepayerAddress, fee: fee },
      () => {
        zkApp.update(mergedTransitionProofs1);
      }
    );
    await txn3.prove();
    sentTxn3 = await txn3.sign([feepayerKey]).send();
  } catch (err) {
    console.log(err);
  }
  if (sentTxn3?.hash() !== undefined) {
    console.log(`
  Success! Roots of merkle maps to prove publication of
  2nd and 3rd posts have been sent to be published on-chain.
  
  Your smart contract state will be updated
  as soon as the transaction is included in a block:
  https://berkeley.minaexplorer.com/transaction/${sentTxn3.hash()}

  If the transaction fails, execute this step again. The transaction
  probably took too long to be included in a block, so the block height
  associated to the post deletion or publication is no longer valid
  (block length is used as a way to timestamp at which point a post was
  posted or deleted).
  `);

    const post2JSON = JSON.stringify(valid3.postState);
    const post3JSON = JSON.stringify(valid4.postState);
    await fs.writeFile('./build/src/post2.json', post2JSON, 'utf-8');
    await fs.writeFile('./build/src/post3.json', post3JSON, 'utf-8');
  }
}

// ==============================================================================
// 4. Publishes on-chain proof for deletion of 3rd post
//    and publication of 4th post
// ==============================================================================

if (numberOfTransaction === 4) {
  const post1: PostState = JSON.parse(
    await fs.readFile('./build/src/post1.json', 'utf8')
  );
  const post2: PostState = JSON.parse(
    await fs.readFile('./build/src/post2.json', 'utf8')
  );
  const post3: PostState = JSON.parse(
    await fs.readFile('./build/src/post3.json', 'utf8')
  );

  // Restore PostState for posts produced in previous transactions
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
  const post2Restored = new PostState({
    posterAddress: feepayerAddress,
    postContentID: CircuitString.fromString(
      'b3333333333333333333333333333333333333333333333333333333333'
    ),
    allPostsCounter: Field(post2.allPostsCounter),
    userPostsCounter: Field(post2.userPostsCounter),
    postBlockHeight: Field(post2.postBlockHeight),
    deletionBlockHeight: Field(post2.deletionBlockHeight),
  });
  const post3Restored = new PostState({
    posterAddress: zkAppAddress,
    postContentID: CircuitString.fromString(
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    ),
    allPostsCounter: Field(post3.allPostsCounter),
    userPostsCounter: Field(post3.userPostsCounter),
    postBlockHeight: Field(post3.postBlockHeight),
    deletionBlockHeight: Field(post3.deletionBlockHeight),
  });

  // Restore MerkleMap produced in previous transactions
  postsMap.set(
    Poseidon.hash([feepayerAddressAsField, post1Restored.postContentID.hash()]),
    post1Restored.hash()
  );
  usersPostsCountersMap.set(
    feepayerAddressAsField,
    Field(post2Restored.userPostsCounter)
  );
  postsMap.set(
    Poseidon.hash([feepayerAddressAsField, post2Restored.postContentID.hash()]),
    post2Restored.hash()
  );
  usersPostsCountersMap.set(
    zkAppAddressAsField,
    Field(post3Restored.userPostsCounter)
  );
  postsMap.set(
    Poseidon.hash([zkAppAddressAsField, post3Restored.postContentID.hash()]),
    post3Restored.hash()
  );

  const lastBlock4 = await fetchLastBlock(config.url);

  const valid5 = createPostDeletionTransitionValidInputs(
    zkAppKey,
    Field(3),
    post3Restored,
    Field(lastBlock4.blockchainLength.toBigint())
  );

  const transition5 = PostsTransition.createPostDeletionTransition(
    valid5.signature,
    valid5.allPostsCounter,
    valid5.usersPostsCounters,
    valid5.initialPosts,
    valid5.latestPosts,
    valid5.initialPostState,
    valid5.postWitness,
    valid5.latestPostState.deletionBlockHeight
  );

  const proof5 = await Posts.provePostDeletionTransition(
    transition5,
    valid5.signature,
    valid5.allPostsCounter,
    valid5.usersPostsCounters,
    valid5.initialPosts,
    valid5.latestPosts,
    valid5.initialPostState,
    valid5.postWitness,
    valid5.latestPostState.deletionBlockHeight
  );

  const valid6 = createPostPublishingTransitionValidInputs(
    zkAppAddress,
    zkAppKey,
    CircuitString.fromString(
      'b4444444444444444444444444444444444444444444444444444444444'
    ),
    Field(4),
    Field(2),
    Field(lastBlock4.blockchainLength.toBigint())
  );

  const transition6 = PostsTransition.createPostPublishingTransition(
    valid6.signature,
    valid6.postState.allPostsCounter.sub(1),
    valid6.initialUsersPostsCounters,
    valid6.latestUsersPostsCounters,
    valid6.postState.userPostsCounter.sub(1),
    valid6.userPostsCounterWitness,
    valid6.initialPosts,
    valid6.latestPosts,
    valid6.postState,
    valid6.postWitness
  );

  const proof6 = await Posts.provePostPublishingTransition(
    transition6,
    valid6.signature,
    valid6.postState.allPostsCounter.sub(1),
    valid6.initialUsersPostsCounters,
    valid6.latestUsersPostsCounters,
    valid6.postState.userPostsCounter.sub(1),
    valid6.userPostsCounterWitness,
    valid6.initialPosts,
    valid6.latestPosts,
    valid6.postState,
    valid6.postWitness
  );

  const mergedTransitions2 = PostsTransition.mergePostsTransitions(
    transition5,
    transition6
  );
  const mergedTransitionProofs2 = await Posts.proveMergedPostsTransitions(
    mergedTransitions2,
    proof5,
    proof6
  );

  let sentTxn4;

  try {
    const txn4 = await Mina.transaction(
      { sender: feepayerAddress, fee: fee },
      () => {
        zkApp.update(mergedTransitionProofs2);
      }
    );
    await txn4.prove();
    sentTxn4 = await txn4.sign([feepayerKey]).send();
  } catch (err) {
    console.log(err);
  }
  if (sentTxn4?.hash() !== undefined) {
    console.log(`
  Success! Roots of merkle maps to prove deletion of 3rd post
  and publication of 4th post have been sent to be published on-chain.
  
  Your smart contract state will be updated
  as soon as the transaction is included in a block:
  https://berkeley.minaexplorer.com/transaction/${sentTxn4.hash()}

  If the transaction fails, execute this step again. The transaction
  probably took too long to be included in a block, so the block height
  associated to the post deletion or publication is no longer valid
  (block length is used as a way to timestamp at which point a post was
  posted or deleted).
  `);

    const post3JSON = JSON.stringify(valid5.latestPostState);
    const post4JSON = JSON.stringify(valid6.postState);
    await fs.writeFile('./build/src/post3.json', post3JSON, 'utf-8');
    await fs.writeFile('./build/src/post4.json', post4JSON, 'utf-8');
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