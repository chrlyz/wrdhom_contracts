import { PostsContract } from '../posts/PostsContract';
import { PostsTransition, Posts } from '../posts/Posts';
import { CommentsContract } from './CommentsContract';
import { CommentsTransition, Comments } from './Comments';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  MerkleMap,
  CircuitString,
  UInt32,
} from 'o1js';
import { Config } from '../posts/PostsDeploy';
import fs from 'fs/promises';
import {
  deployPostsContract,
  createPostPublishingTransitionValidInputs,
} from '../posts/PostsUtils';
import { createCommentTransitionValidInputs } from './CommentsUtils';

let proofsEnabled = true;

describe(`the CommentsContract and the Comments ZkProgram`, () => {
  let Local: ReturnType<typeof Mina.LocalBlockchain>,
    user1Address: PublicKey,
    user1Key: PrivateKey,
    user2Address: PublicKey,
    user2Key: PrivateKey,
    postsContractAddress: PublicKey,
    postsContractKey: PrivateKey,
    postsContract: PostsContract,
    usersPostsCountersMap: MerkleMap,
    postsMap: MerkleMap,
    commentsContractAddress: PublicKey,
    commentsContractKey: PrivateKey,
    commentsContract: CommentsContract,
    usersCommentsCountersMap: MerkleMap,
    targetsCommentsCountersMap: MerkleMap,
    commentsMap: MerkleMap;

  beforeAll(async () => {
    if (proofsEnabled) {
      console.log('Compiling Posts ZkProgram...');
      await Posts.compile();
      console.log('Compiling PostsContract...');
      await PostsContract.compile();
      console.log('Compiling Comments ZkProgram...');
      await Comments.compile();
      console.log('Compiling CommentsContract...');
      await CommentsContract.compile();
      console.log('Compiled');
    }
  });

  beforeEach(async () => {
    Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: user1Key, publicKey: user1Address } = Local.testAccounts[0]);
    ({ privateKey: user2Key, publicKey: user2Address } = Local.testAccounts[1]);

    const configJson: Config = JSON.parse(
      await fs.readFile('config.json', 'utf8')
    );
    const postsConfig = configJson.deployAliases['posts'];
    const postsContractKeyBase58: { privateKey: string } = JSON.parse(
      await fs.readFile(postsConfig.keyPath, 'utf8')
    );
    postsContractKey = PrivateKey.fromBase58(postsContractKeyBase58.privateKey);
    postsContractAddress = postsContractKey.toPublicKey();
    postsContract = new PostsContract(postsContractAddress);
    usersPostsCountersMap = new MerkleMap();
    postsMap = new MerkleMap();

    const commentsConfig = configJson.deployAliases['comments'];
    const commentsContractKeyBase58: { privateKey: string } = JSON.parse(
      await fs.readFile(commentsConfig.keyPath, 'utf8')
    );
    commentsContractKey = PrivateKey.fromBase58(
      commentsContractKeyBase58.privateKey
    );
    commentsContractAddress = commentsContractKey.toPublicKey();
    commentsContract = new CommentsContract(commentsContractAddress);
    usersCommentsCountersMap = new MerkleMap();
    targetsCommentsCountersMap = new MerkleMap();
    commentsMap = new MerkleMap();
  });

  async function deployCommentsContract() {
    const txn = await Mina.transaction(user1Address, () => {
      AccountUpdate.fundNewAccount(user1Address);
      commentsContract.deploy();
    });
    await txn.prove();
    await txn.sign([user1Key, commentsContractKey]).send();
  }

  test(`CommentsContract and Comments zkProgram functionality`, async () => {
    // ==============================================================================
    // 1. Deploys PostsContract and CommentsContract.
    // ==============================================================================

    await deployPostsContract(
      user1Address,
      user1Key,
      postsContract,
      postsContractKey
    );

    // Validate expected state
    const allPostsCounterState = postsContract.allPostsCounter.get();
    const usersPostsCountersState = postsContract.usersPostsCounters.get();
    const postsState = postsContract.posts.get();
    const usersPostsCountersRoot = usersPostsCountersMap.getRoot();
    const postsRoot = postsMap.getRoot();
    expect(allPostsCounterState).toEqual(Field(0));
    expect(usersPostsCountersState).toEqual(usersPostsCountersRoot);
    expect(postsState).toEqual(postsRoot);

    console.log('PostsContract deployed');

    await deployCommentsContract();

    // Validate expected state
    const allCommentsCounterState = commentsContract.allCommentsCounter.get();
    const usersCommentsCountersState =
      commentsContract.usersCommentsCounters.get();
    const targetsCommentsCountersState =
      commentsContract.targetsCommentsCounters.get();
    const commentsState = commentsContract.comments.get();
    const usersCommentsCountersRoot = usersCommentsCountersMap.getRoot();
    const targetsCommentsCountersRoot = targetsCommentsCountersMap.getRoot();
    const commentsRoot = commentsMap.getRoot();
    expect(allCommentsCounterState).toEqual(Field(0));
    expect(usersCommentsCountersState).toEqual(usersCommentsCountersRoot);
    expect(targetsCommentsCountersState).toEqual(targetsCommentsCountersRoot);
    expect(commentsState).toEqual(commentsRoot);

    console.log('CommentsContract deployed');

    // ==============================================================================
    // 2. Publishes on-chain proof for publication of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid1 = createPostPublishingTransitionValidInputs(
      user1Address,
      user1Key,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1),
      Field(0),
      usersPostsCountersMap,
      postsMap
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Send valid proof to update our on-chain state
    const txn1 = await Mina.transaction(user1Address, () => {
      postsContract.update(proof1);
    });
    await txn1.prove();
    await txn1.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(1));

    // Validate expected state
    const allPostsCounterState1 = postsContract.allPostsCounter.get();
    const usersPostsCountersState1 = postsContract.usersPostsCounters.get();
    const postsState1 = postsContract.posts.get();
    const usersPostsCountersRoot1 = usersPostsCountersMap.getRoot();
    const postsRoot1 = postsMap.getRoot();
    expect(allPostsCounterState1).toEqual(Field(1));
    expect(allPostsCounterState1).not.toEqual(allPostsCounterState);
    expect(usersPostsCountersState1).toEqual(usersPostsCountersRoot1);
    expect(usersPostsCountersState1).not.toEqual(usersPostsCountersState);
    expect(postsState1).toEqual(postsRoot1);
    expect(postsState1).not.toEqual(postsRoot);

    console.log('1st post published');

    // ==============================================================================
    // 3. Publishes on-chain proof for commenting to the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid2 = createCommentTransitionValidInputs(
      valid1.postState,
      user2Address,
      user2Key,
      CircuitString.fromString('comment1ContentID'),
      Field(1),
      Field(1),
      Field(1),
      Field(1),
      postsMap,
      usersCommentsCountersMap,
      targetsCommentsCountersMap,
      commentsMap
    );

    // Create a valid state transition
    const transition2 = CommentsTransition.createCommentPublishingTransition(
      valid2.signature,
      postsMap.getRoot(),
      valid2.targetState,
      valid2.targetWitness,
      valid2.commentState.allCommentsCounter.sub(1),
      valid2.initialUsersCommentsCounters,
      valid2.latestUsersCommentsCounters,
      valid2.commentState.userCommentsCounter.sub(1),
      valid2.userCommentsCounterWitness,
      valid2.initialTargetsCommentsCounters,
      valid2.latestTargetsCommentsCounters,
      valid2.commentState.targetCommentsCounter.sub(1),
      valid2.targetCommentsCounterWitness,
      valid2.initialComments,
      valid2.latestComments,
      valid2.commentWitness,
      valid2.commentState
    );

    // Create valid proof for our state transition
    const proof2 = await Comments.proveCommentPublishingTransition(
      transition2,
      valid2.signature,
      postsMap.getRoot(),
      valid2.targetState,
      valid2.targetWitness,
      valid2.commentState.allCommentsCounter.sub(1),
      valid2.initialUsersCommentsCounters,
      valid2.latestUsersCommentsCounters,
      valid2.commentState.userCommentsCounter.sub(1),
      valid2.userCommentsCounterWitness,
      valid2.initialTargetsCommentsCounters,
      valid2.latestTargetsCommentsCounters,
      valid2.commentState.targetCommentsCounter.sub(1),
      valid2.targetCommentsCounterWitness,
      valid2.initialComments,
      valid2.latestComments,
      valid2.commentWitness,
      valid2.commentState
    );

    // Send valid proof to update our on-chain state
    const txn2 = await Mina.transaction(user1Address, () => {
      commentsContract.update(proof2);
    });
    await txn2.prove();
    await txn2.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(2));

    const allCommentsCounterState1 = commentsContract.allCommentsCounter.get();
    const usersCommentsCountersState1 =
      commentsContract.usersCommentsCounters.get();
    const targetsCommentsCountersState1 =
      commentsContract.targetsCommentsCounters.get();
    const commentsState1 = commentsContract.comments.get();
    const usersCommentsCountersRoot1 = usersCommentsCountersMap.getRoot();
    const targetsCommentsCountersRoot1 = targetsCommentsCountersMap.getRoot();
    const commentsRoot1 = commentsMap.getRoot();
    expect(allCommentsCounterState1).toEqual(Field(1));
    expect(usersCommentsCountersState1).toEqual(usersCommentsCountersRoot1);
    expect(usersCommentsCountersState1).not.toEqual(usersCommentsCountersRoot);
    expect(targetsCommentsCountersState1).toEqual(targetsCommentsCountersRoot1);
    expect(targetsCommentsCountersState1).not.toEqual(
      targetsCommentsCountersRoot
    );
    expect(commentsState1).toEqual(commentsRoot1);
    expect(commentsState1).not.toEqual(commentsRoot);

    console.log('Commented to 1st post');
  });
});
