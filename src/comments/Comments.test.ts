import { PostsContract } from '../posts/PostsContract';
import { PostsTransition, Posts } from '../posts/Posts';
import { CommentsContract } from './CommentsContract';
import { CommentsTransition, Comments, CommentState } from './Comments';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  MerkleMap,
  CircuitString,
  UInt32,
  Poseidon,
} from 'o1js';
import { Config } from '../posts/PostsDeploy';
import fs from 'fs/promises';
import {
  deployPostsContract,
  createPostPublishingTransitionValidInputs,
} from '../posts/PostsUtils';
import {
  deployCommentsContract,
  createCommentTransitionValidInputs,
  createCommentDeletionTransitionValidInputs,
  createCommentRestorationTransitionValidInputs,
} from './CommentsUtils';

let proofsEnabled = true;

describe(`the CommentsContract and the Comments ZkProgram`, () => {
  let user1Address: PublicKey,
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
    commentsMap: MerkleMap,
    Local: any

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
    Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    user1Key = Local.testAccounts[0].key;
    user1Address = Local.testAccounts[0].key.toPublicKey();
    user2Key = Local.testAccounts[1].key;
    user2Address = Local.testAccounts[1].key.toPublicKey();
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

    await deployCommentsContract(
      user1Address,
      user1Key,
      commentsContract,
      commentsContractKey
    );

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
    const txn1 = await Mina.transaction(user1Address, async () => {
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
      CircuitString.fromString(
        'bafkreifedy7l6a7izydrz7zr5nnezkfttj3be5hcbydbznn2d32ai7j26u'
      ),
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
    const txn2 = await Mina.transaction(user1Address, async () => {
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

    // ==============================================================================
    // 4. Publishes on-chain proof for deleting the comment to the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid3 = createCommentDeletionTransitionValidInputs(
      valid2.targetState,
      user2Key,
      Field(1),
      valid2.commentState,
      Field(2),
      postsMap,
      usersCommentsCountersMap,
      targetsCommentsCountersMap,
      commentsMap
    );

    // Create a valid state transition
    const transition3 = CommentsTransition.createCommentDeletionTransition(
      valid3.signature,
      valid3.targets,
      valid3.targetState,
      valid3.targetWitness,
      valid3.allCommentsCounter,
      valid3.usersCommentsCounters,
      valid3.targetsCommentsCounters,
      valid3.initialComments,
      valid3.latestComments,
      valid3.initialCommentState,
      valid3.commentWitness,
      valid3.latestCommentState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    const proof3 = await Comments.proveCommentDeletionTransition(
      transition3,
      valid3.signature,
      valid3.targets,
      valid3.targetState,
      valid3.targetWitness,
      valid3.allCommentsCounter,
      valid3.usersCommentsCounters,
      valid3.targetsCommentsCounters,
      valid3.initialComments,
      valid3.latestComments,
      valid3.initialCommentState,
      valid3.commentWitness,
      valid3.latestCommentState.deletionBlockHeight
    );

    // Send valid proof to update our on-chain state
    const txn3 = await Mina.transaction(user1Address, async () => {
      commentsContract.update(proof3);
    });
    await txn3.prove();
    await txn3.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(3));

    const allCommentsCounterState2 = commentsContract.allCommentsCounter.get();
    const usersCommentsCountersState2 =
      commentsContract.usersCommentsCounters.get();
    const targetsCommentsCountersState2 =
      commentsContract.targetsCommentsCounters.get();
    const commentsState2 = commentsContract.comments.get();
    const usersCommentsCountersRoot2 = usersCommentsCountersMap.getRoot();
    const targetsCommentsCountersRoot2 = targetsCommentsCountersMap.getRoot();
    const commentsRoot2 = commentsMap.getRoot();
    expect(allCommentsCounterState2).toEqual(Field(1));
    expect(usersCommentsCountersState2).toEqual(usersCommentsCountersRoot2);
    expect(usersCommentsCountersState2).toEqual(usersCommentsCountersRoot1);
    expect(targetsCommentsCountersState2).toEqual(targetsCommentsCountersRoot2);
    expect(targetsCommentsCountersState2).toEqual(targetsCommentsCountersRoot1);
    expect(commentsState2).toEqual(commentsRoot2);
    expect(commentsState2).not.toEqual(commentsRoot1);

    console.log('Comment to 1st post deleted');

    // ==============================================================================
    // 5. Publishes on-chain proof for restoring the comment to the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid4 = createCommentRestorationTransitionValidInputs(
      valid3.targetState,
      user2Key,
      Field(1),
      valid3.latestCommentState,
      Field(3),
      postsMap,
      usersCommentsCountersMap,
      targetsCommentsCountersMap,
      commentsMap
    );

    // Create a valid state transition
    const transition4 = CommentsTransition.createCommentRestorationTransition(
      valid4.signature,
      valid4.targets,
      valid4.targetState,
      valid4.targetWitness,
      valid4.allCommentsCounter,
      valid4.usersCommentsCounters,
      valid4.targetsCommentsCounters,
      valid4.initialComments,
      valid4.latestComments,
      valid4.initialCommentState,
      valid4.commentWitness,
      valid4.latestCommentState.restorationBlockHeight
    );

    // Create valid proof for our state transition
    const proof4 = await Comments.proveCommentRestorationTransition(
      transition4,
      valid4.signature,
      valid4.targets,
      valid4.targetState,
      valid4.targetWitness,
      valid4.allCommentsCounter,
      valid4.usersCommentsCounters,
      valid4.targetsCommentsCounters,
      valid4.initialComments,
      valid4.latestComments,
      valid4.initialCommentState,
      valid4.commentWitness,
      valid4.latestCommentState.restorationBlockHeight
    );

    // Send valid proof to update our on-chain state
    const txn4 = await Mina.transaction(user1Address, async () => {
      commentsContract.update(proof4);
    });
    await txn4.prove();
    await txn4.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(4));

    const allCommentsCounterState3 = commentsContract.allCommentsCounter.get();
    const usersCommentsCountersState3 =
      commentsContract.usersCommentsCounters.get();
    const targetsCommentsCountersState3 =
      commentsContract.targetsCommentsCounters.get();
    const commentsState3 = commentsContract.comments.get();
    const usersCommentsCountersRoot3 = usersCommentsCountersMap.getRoot();
    const targetsCommentsCountersRoot3 = targetsCommentsCountersMap.getRoot();
    const commentsRoot3 = commentsMap.getRoot();
    expect(allCommentsCounterState3).toEqual(Field(1));
    expect(usersCommentsCountersState3).toEqual(usersCommentsCountersRoot3);
    expect(usersCommentsCountersState3).toEqual(usersCommentsCountersRoot2);
    expect(targetsCommentsCountersState3).toEqual(targetsCommentsCountersRoot3);
    expect(targetsCommentsCountersState3).toEqual(targetsCommentsCountersRoot2);
    expect(commentsState3).toEqual(commentsRoot3);
    expect(commentsState3).not.toEqual(commentsRoot2);

    console.log('Comment to 1st post restored');

    // ==============================================================================
    // 6. Publishes on-chain proof (from merged proofs) for 2 new comments to
    //    the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid5 = createCommentTransitionValidInputs(
      valid1.postState,
      user1Address,
      user1Key,
      CircuitString.fromString(
        'bafkreiendqwlv3ghhkaficpkkdcykrrtv52b3txgi47pmnyu4pq7wvnxxy'
      ),
      Field(2),
      Field(1),
      Field(2),
      Field(4),
      postsMap,
      usersCommentsCountersMap,
      targetsCommentsCountersMap,
      commentsMap
    );

    // Create a valid state transition
    const transition5 = CommentsTransition.createCommentPublishingTransition(
      valid5.signature,
      valid5.targets,
      valid5.targetState,
      valid5.targetWitness,
      valid5.commentState.allCommentsCounter.sub(1),
      valid5.initialUsersCommentsCounters,
      valid5.latestUsersCommentsCounters,
      valid5.commentState.userCommentsCounter.sub(1),
      valid5.userCommentsCounterWitness,
      valid5.initialTargetsCommentsCounters,
      valid5.latestTargetsCommentsCounters,
      valid5.commentState.targetCommentsCounter.sub(1),
      valid5.targetCommentsCounterWitness,
      valid5.initialComments,
      valid5.latestComments,
      valid5.commentWitness,
      valid5.commentState
    );

    // Create valid proof for our state transition
    const proof5 = await Comments.proveCommentPublishingTransition(
      transition5,
      valid5.signature,
      valid5.targets,
      valid5.targetState,
      valid5.targetWitness,
      valid5.commentState.allCommentsCounter.sub(1),
      valid5.initialUsersCommentsCounters,
      valid5.latestUsersCommentsCounters,
      valid5.commentState.userCommentsCounter.sub(1),
      valid5.userCommentsCounterWitness,
      valid5.initialTargetsCommentsCounters,
      valid5.latestTargetsCommentsCounters,
      valid5.commentState.targetCommentsCounter.sub(1),
      valid5.targetCommentsCounterWitness,
      valid5.initialComments,
      valid5.latestComments,
      valid5.commentWitness,
      valid5.commentState
    );

    // Prepare inputs to create a valid state transition
    const valid6 = createCommentTransitionValidInputs(
      valid1.postState,
      user2Address,
      user2Key,
      CircuitString.fromString(
        'bafkreid66gqf3q4qfggfqqovb33mh5ophojtiwld3kezvndjyxzqamub3m'
      ),
      Field(3),
      Field(2),
      Field(3),
      Field(4),
      postsMap,
      usersCommentsCountersMap,
      targetsCommentsCountersMap,
      commentsMap
    );

    // Create a valid state transition
    const transition6 = CommentsTransition.createCommentPublishingTransition(
      valid6.signature,
      valid6.targets,
      valid6.targetState,
      valid6.targetWitness,
      valid6.commentState.allCommentsCounter.sub(1),
      valid6.initialUsersCommentsCounters,
      valid6.latestUsersCommentsCounters,
      valid6.commentState.userCommentsCounter.sub(1),
      valid6.userCommentsCounterWitness,
      valid6.initialTargetsCommentsCounters,
      valid6.latestTargetsCommentsCounters,
      valid6.commentState.targetCommentsCounter.sub(1),
      valid6.targetCommentsCounterWitness,
      valid6.initialComments,
      valid6.latestComments,
      valid6.commentWitness,
      valid6.commentState
    );

    // Create valid proof for our state transition
    const proof6 = await Comments.proveCommentPublishingTransition(
      transition6,
      valid6.signature,
      valid6.targets,
      valid6.targetState,
      valid6.targetWitness,
      valid6.commentState.allCommentsCounter.sub(1),
      valid6.initialUsersCommentsCounters,
      valid6.latestUsersCommentsCounters,
      valid6.commentState.userCommentsCounter.sub(1),
      valid6.userCommentsCounterWitness,
      valid6.initialTargetsCommentsCounters,
      valid6.latestTargetsCommentsCounters,
      valid6.commentState.targetCommentsCounter.sub(1),
      valid6.targetCommentsCounterWitness,
      valid6.initialComments,
      valid6.latestComments,
      valid6.commentWitness,
      valid6.commentState
    );

    // Merge valid state transitions
    const mergedTransitions1 = CommentsTransition.mergeCommentsTransitions(
      transition5,
      transition6
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs1 =
      await Comments.proveMergedCommentsTransitions(
        mergedTransitions1,
        proof5,
        proof6
      );

    // Send valid proof to update our on-chain state
    const txn5 = await Mina.transaction(user1Address, async () => {
      commentsContract.update(mergedTransitionProofs1);
    });
    await txn5.prove();
    await txn5.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(5));

    const allCommentsCounterState4 = commentsContract.allCommentsCounter.get();
    const usersCommentsCountersState4 =
      commentsContract.usersCommentsCounters.get();
    const targetsCommentsCountersState4 =
      commentsContract.targetsCommentsCounters.get();
    const commentsState4 = commentsContract.comments.get();
    const usersCommentsCountersRoot4 = usersCommentsCountersMap.getRoot();
    const targetsCommentsCountersRoot4 = targetsCommentsCountersMap.getRoot();
    const commentsRoot4 = commentsMap.getRoot();
    expect(allCommentsCounterState4).toEqual(Field(3));
    expect(usersCommentsCountersState4).toEqual(usersCommentsCountersRoot4);
    expect(usersCommentsCountersState4).not.toEqual(usersCommentsCountersRoot3);
    expect(targetsCommentsCountersState4).toEqual(targetsCommentsCountersRoot4);
    expect(targetsCommentsCountersState4).not.toEqual(
      targetsCommentsCountersRoot3
    );
    expect(commentsState4).toEqual(commentsRoot4);
    expect(commentsState4).not.toEqual(commentsRoot3);

    console.log('2nd and 3rd comments published through merged proofs');

    // ==============================================================================
    // 7. Extra validation for all the state updates so far.
    // ==============================================================================

    const newUsersCommentsCountersMap = new MerkleMap();
    const user1AddressAsField = Poseidon.hash(user1Address.toFields());
    const user2AddressAsField = Poseidon.hash(user2Address.toFields());
    newUsersCommentsCountersMap.set(user1AddressAsField, Field(1));
    newUsersCommentsCountersMap.set(user2AddressAsField, Field(2));
    expect(newUsersCommentsCountersMap.getRoot()).toEqual(
      usersCommentsCountersState4
    );

    const newTargetsCommentsCountersMap = new MerkleMap();
    newTargetsCommentsCountersMap.set(valid2.commentState.targetKey, Field(3));
    expect(newTargetsCommentsCountersMap.getRoot()).toEqual(
      targetsCommentsCountersState4
    );

    const comment1 = new CommentState({
      isTargetPost: valid4.latestCommentState.isTargetPost,
      targetKey: valid4.latestCommentState.targetKey,
      commenterAddress: valid4.latestCommentState.commenterAddress,
      commentContentID: valid4.latestCommentState.commentContentID,
      allCommentsCounter: valid4.latestCommentState.allCommentsCounter,
      userCommentsCounter: valid4.latestCommentState.userCommentsCounter,
      targetCommentsCounter: valid4.latestCommentState.targetCommentsCounter,
      commentBlockHeight: valid4.latestCommentState.commentBlockHeight,
      deletionBlockHeight: valid4.latestCommentState.deletionBlockHeight,
      restorationBlockHeight: valid4.latestCommentState.restorationBlockHeight,
    });

    const comment2 = new CommentState({
      isTargetPost: valid5.commentState.isTargetPost,
      targetKey: valid5.commentState.targetKey,
      commenterAddress: valid5.commentState.commenterAddress,
      commentContentID: valid5.commentState.commentContentID,
      allCommentsCounter: valid5.commentState.allCommentsCounter,
      userCommentsCounter: valid5.commentState.userCommentsCounter,
      targetCommentsCounter: valid5.commentState.targetCommentsCounter,
      commentBlockHeight: valid5.commentState.commentBlockHeight,
      deletionBlockHeight: valid5.commentState.deletionBlockHeight,
      restorationBlockHeight: valid5.commentState.restorationBlockHeight,
    });

    const comment3 = new CommentState({
      isTargetPost: valid6.commentState.isTargetPost,
      targetKey: valid6.commentState.targetKey,
      commenterAddress: valid6.commentState.commenterAddress,
      commentContentID: valid6.commentState.commentContentID,
      allCommentsCounter: valid6.commentState.allCommentsCounter,
      userCommentsCounter: valid6.commentState.userCommentsCounter,
      targetCommentsCounter: valid6.commentState.targetCommentsCounter,
      commentBlockHeight: valid6.commentState.commentBlockHeight,
      deletionBlockHeight: valid6.commentState.deletionBlockHeight,
      restorationBlockHeight: valid6.commentState.restorationBlockHeight,
    });

    const newCommentsMap = new MerkleMap();

    const comment1Key = Poseidon.hash([
      valid4.latestCommentState.targetKey,
      user2AddressAsField,
      valid4.latestCommentState.commentContentID.hash(),
    ]);
    newCommentsMap.set(comment1Key, comment1.hash());

    const comment2Key = Poseidon.hash([
      valid5.commentState.targetKey,
      user1AddressAsField,
      valid5.commentState.commentContentID.hash(),
    ]);
    newCommentsMap.set(comment2Key, comment2.hash());

    const comment3Key = Poseidon.hash([
      valid6.commentState.targetKey,
      user2AddressAsField,
      valid6.commentState.commentContentID.hash(),
    ]);
    newCommentsMap.set(comment3Key, comment3.hash());

    expect(newCommentsMap.getRoot()).toEqual(commentsState4);

    console.log('Successful extra validation of all the state updates');
  });
});
