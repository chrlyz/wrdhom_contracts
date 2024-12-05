import { PostsContract } from '../posts/PostsContract';
import { PostsTransition, Posts } from '../posts/Posts';
import { RepostsContract } from './RepostsContract';
import { RepostsTransition, Reposts, RepostState } from './Reposts';
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
  deployRepostsContract,
  createRepostTransitionValidInputs,
  createRepostDeletionTransitionValidInputs,
  createRepostRestorationTransitionValidInputs,
} from './RepostsUtils';
import * as dotenv from 'dotenv';

dotenv.config();
const PROOFS_ENABLED = process.env.PROOFS_ENABLED === 'true' || false;

describe(`the RepostsContract and the Reposts ZkProgram`, () => {
  let Local: any,
    user1Address: PublicKey,
    user1Key: PrivateKey,
    user2Address: PublicKey,
    user2Key: PrivateKey,
    user3Key: PrivateKey,
    user3Address: PublicKey,
    postsContractAddress: PublicKey,
    postsContractKey: PrivateKey,
    postsContract: PostsContract,
    usersPostsCountersMap: MerkleMap,
    postsMap: MerkleMap,
    stateHistoryMap: MerkleMap,
    repostsContractAddress: PublicKey,
    repostsContractKey: PrivateKey,
    repostsContract: RepostsContract,
    usersRepostsCountersMap: MerkleMap,
    targetsRepostsCountersMap: MerkleMap,
    repostsStateHistoryMap: MerkleMap,
    repostsMap: MerkleMap;

  beforeAll(async () => {
    if (PROOFS_ENABLED) {
      console.log('Compiling Posts ZkProgram...');
      await Posts.compile();
      console.log('Compiling PostsContract...');
      await PostsContract.compile();
      console.log('Compiling Reposts ZkProgram...');
      await Reposts.compile();
      console.log('Compiling RepostsContract...');
      await RepostsContract.compile();
      console.log('Compiled');
    }
  });

  beforeEach(async () => {
    Local = await Mina.LocalBlockchain({ proofsEnabled: PROOFS_ENABLED });
    Mina.setActiveInstance(Local);
    user1Key = Local.testAccounts[0].key;
    user1Address = Local.testAccounts[0].key.toPublicKey();
    user2Key = Local.testAccounts[1].key;
    user2Address = Local.testAccounts[1].key.toPublicKey();
    user3Key = Local.testAccounts[2].key;
    user3Address = Local.testAccounts[2].key.toPublicKey();
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
    stateHistoryMap = new MerkleMap();

    const repostsConfig = configJson.deployAliases['reposts'];
    const repostsContractKeyBase58: { privateKey: string } = JSON.parse(
      await fs.readFile(repostsConfig.keyPath, 'utf8')
    );
    repostsContractKey = PrivateKey.fromBase58(
      repostsContractKeyBase58.privateKey
    );
    repostsContractAddress = repostsContractKey.toPublicKey();
    repostsContract = new RepostsContract(repostsContractAddress);
    usersRepostsCountersMap = new MerkleMap();
    targetsRepostsCountersMap = new MerkleMap();
    repostsMap = new MerkleMap();
    repostsStateHistoryMap = new MerkleMap();
  });

  test(`RepostsContract and Reposts zkProgram functionality`, async () => {
    // ==============================================================================
    // 1. Deploys PostsContract and RepostsContract.
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
    const lastUpdate = postsContract.lastUpdate.get();
    const stateHistory = postsContract.stateHistory.get();

    const usersPostsCountersRoot = usersPostsCountersMap.getRoot();
    const postsRoot = postsMap.getRoot();
    const stateHistoryRoot = stateHistoryMap.getRoot();

    expect(allPostsCounterState).toEqual(Field(0));
    expect(usersPostsCountersState).toEqual(usersPostsCountersRoot);
    expect(postsState).toEqual(postsRoot);
    expect(lastUpdate).toEqual(Field(0));
    expect(stateHistory).toEqual(stateHistoryRoot);

    console.log('PostsContract deployed');

    await deployRepostsContract(
      user1Address,
      user1Key,
      repostsContract,
      repostsContractKey
    );

    // Validate expected state
    const allRepostsCounterState = repostsContract.allRepostsCounter.get();
    const usersRepostsCountersState = repostsContract.usersRepostsCounters.get();
    const targetsRepostsCountersState = repostsContract.targetsRepostsCounters.get();
    const repostsState = repostsContract.reposts.get();
    const repostsLastUpdateState = repostsContract.lastUpdate.get();
    const repostsStateHistoryState = repostsContract.stateHistory.get();

    const usersRepostsCountersRoot = usersRepostsCountersMap.getRoot();
    const targetsRepostsCountersRoot = targetsRepostsCountersMap.getRoot();
    const repostsRoot = repostsMap.getRoot();
    const repostsStateHistoryRoot = repostsStateHistoryMap.getRoot();

    expect(allRepostsCounterState).toEqual(Field(0));
    expect(usersRepostsCountersState).toEqual(usersRepostsCountersRoot);
    expect(targetsRepostsCountersState).toEqual(targetsRepostsCountersRoot);
    expect(repostsState).toEqual(repostsRoot);
    expect(repostsLastUpdateState).toEqual(Field(0));
    expect(repostsStateHistoryState).toEqual(repostsStateHistoryRoot);

    console.log('RepostsContract deployed');

    // ==============================================================================
    // 2. Publishes on-chain proof for publication of 1st post.
    // ==============================================================================

    const allPostsCounter1 = Field(1);
    const userPostsCounter1 = Field(1);
    const blockHeight1 = Field(0);

    // Prepare inputs to create a valid state transition
    const valid1 = createPostPublishingTransitionValidInputs(
      user1Address,
      user1Key,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      allPostsCounter1,
      userPostsCounter1,
      blockHeight1,
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
    let proof1: any;
    if (PROOFS_ENABLED) {
      proof1 = await Posts.provePostPublishingTransition(
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
    } else {
        proof1 = {
          verify: () => {},
          publicInput: {
            blockHeight: transition1.blockHeight,
            initialAllPostsCounter: transition1.initialAllPostsCounter,
            latestAllPostsCounter: transition1.latestAllPostsCounter,
            initialUsersPostsCounters: transition1.initialUsersPostsCounters,
            latestUsersPostsCounters: transition1.latestUsersPostsCounters,
            initialPosts: transition1.initialPosts,
            latestPosts: transition1.latestPosts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const stateHistoryWitness1 = stateHistoryMap.getWitness(blockHeight1);
    const latestState1 = Poseidon.hash([
      transition1.latestAllPostsCounter,
      transition1.latestUsersPostsCounters,
      transition1.latestPosts
    ]);
    stateHistoryMap.set(blockHeight1, latestState1);
    const txn1 = await Mina.transaction(user1Address, async () => {
      postsContract.update(proof1, stateHistoryWitness1);
    });
    await txn1.prove();
    await txn1.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(1));

    // Validate expected state
    const allPostsCounterState1 = postsContract.allPostsCounter.get();
    const usersPostsCountersState1 = postsContract.usersPostsCounters.get();
    const postsState1 = postsContract.posts.get();
    const lastUpdate1 = postsContract.lastUpdate.get();
    const stateHistory1 = postsContract.stateHistory.get();

    const usersPostsCountersRoot1 = usersPostsCountersMap.getRoot();
    const postsRoot1 = postsMap.getRoot();
    const stateHistoryRoot1 = stateHistoryMap.getRoot();

    expect(allPostsCounterState1).toEqual(Field(1));
    expect(allPostsCounterState1).not.toEqual(allPostsCounterState);
    expect(usersPostsCountersState1).toEqual(usersPostsCountersRoot1);
    expect(usersPostsCountersState1).not.toEqual(usersPostsCountersState);
    expect(postsState1).toEqual(postsRoot1);
    expect(postsState1).not.toEqual(postsRoot);
    expect(lastUpdate1).toEqual(blockHeight1);
    expect(stateHistory1).toEqual(stateHistoryRoot1);
    expect(stateHistory1).not.toEqual(stateHistoryRoot);

    console.log('1st post published');

    // ==============================================================================
    // 3. Publishes on-chain proof for reposting 1st post.
    // ==============================================================================

    const allRepostsCounter1 = Field(1);
    const userRepostsCounter1 = Field(1);
    const targetRepostsCounter1 = Field(1);
    const blockHeight2 = Field(1);

    // Prepare inputs to create a valid state transition
    const valid2 = createRepostTransitionValidInputs(
      valid1.postState,
      user2Address,
      user2Key,
      allRepostsCounter1,
      userRepostsCounter1,
      targetRepostsCounter1,
      blockHeight2,
      postsMap,
      usersRepostsCountersMap,
      targetsRepostsCountersMap,
      repostsMap
    );

    // Create a valid state transition
    const transition2 = RepostsTransition.createRepostPublishingTransition(
      valid2.signature,
      valid2.targets,
      valid2.targetState,
      valid2.targetWitness,
      valid2.repostState.allRepostsCounter.sub(1),
      valid2.initialUsersRepostsCounters,
      valid2.latestUsersRepostsCounters,
      valid2.repostState.userRepostsCounter.sub(1),
      valid2.userRepostsCounterWitness,
      valid2.initialTargetsRepostsCounters,
      valid2.latestTargetsRepostsCounters,
      valid2.repostState.targetRepostsCounter.sub(1),
      valid2.targetRepostsCounterWitness,
      valid2.initialReposts,
      valid2.latestReposts,
      valid2.repostWitness,
      valid2.repostState
    );

    // Create valid proof for our state transition
    let proof2: any;
    if (PROOFS_ENABLED) {
      proof2 = await Reposts.proveRepostPublishingTransition(
        transition2,
        valid2.signature,
        valid2.targets,
        valid2.targetState,
        valid2.targetWitness,
        valid2.repostState.allRepostsCounter.sub(1),
        valid2.initialUsersRepostsCounters,
        valid2.latestUsersRepostsCounters,
        valid2.repostState.userRepostsCounter.sub(1),
        valid2.userRepostsCounterWitness,
        valid2.initialTargetsRepostsCounters,
        valid2.latestTargetsRepostsCounters,
        valid2.repostState.targetRepostsCounter.sub(1),
        valid2.targetRepostsCounterWitness,
        valid2.initialReposts,
        valid2.latestReposts,
        valid2.repostWitness,
        valid2.repostState
      );
    } else {
        proof2 = {
          verify: () => {},
          publicInput: {
            targets: transition2.targets,
            blockHeight: transition2.blockHeight,
            initialAllRepostsCounter: transition2.initialAllRepostsCounter,
            latestAllRepostsCounter: transition2.latestAllRepostsCounter,
            initialUsersRepostsCounters: transition2.initialUsersRepostsCounters,
            latestUsersRepostsCounters: transition2.latestUsersRepostsCounters,
            initialTargetsRepostsCounters: transition2.initialTargetsRepostsCounters,
            latestTargetsRepostsCounters: transition2.latestTargetsRepostsCounters,
            initialReposts: transition2.initialReposts,
            latestReposts: transition2.latestReposts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const repostsStateHistoryWitness1 = repostsStateHistoryMap.getWitness(blockHeight2);
    const repostsLatestState1 = Poseidon.hash([
      transition2.latestAllRepostsCounter,
      transition2.latestUsersRepostsCounters,
      transition2.latestTargetsRepostsCounters,
      transition2.latestReposts
    ]);
    repostsStateHistoryMap.set(blockHeight2, repostsLatestState1);
    const txn2 = await Mina.transaction(user1Address, async () => {
      repostsContract.update(proof2, repostsStateHistoryWitness1);
    });
    await txn2.prove();
    await txn2.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(2));

    const allRepostsCounterState1 = repostsContract.allRepostsCounter.get();
    const usersRepostsCountersState1 = repostsContract.usersRepostsCounters.get();
    const targetsRepostsCountersState1 = repostsContract.targetsRepostsCounters.get();
    const repostsState1 = repostsContract.reposts.get();
    const repostsLastUpdateState1 = repostsContract.lastUpdate.get();
    const repostsStateHistoryState1 = repostsContract.stateHistory.get();

    const usersRepostsCountersRoot1 = usersRepostsCountersMap.getRoot();
    const targetsRepostsCountersRoot1 = targetsRepostsCountersMap.getRoot();
    const repostsRoot1 = repostsMap.getRoot();
    const repostsStateHistoryRoot1 = repostsStateHistoryMap.getRoot();

    expect(allRepostsCounterState1).toEqual(Field(1));
    expect(usersRepostsCountersState1).toEqual(usersRepostsCountersRoot1);
    expect(usersRepostsCountersState1).not.toEqual(usersRepostsCountersRoot);
    expect(targetsRepostsCountersState1).toEqual(targetsRepostsCountersRoot1);
    expect(targetsRepostsCountersState1).not.toEqual(targetsRepostsCountersRoot);
    expect(repostsState1).toEqual(repostsRoot1);
    expect(repostsState1).not.toEqual(repostsRoot);
    expect(repostsLastUpdateState1).toEqual(blockHeight2);
    expect(repostsStateHistoryState1).toEqual(repostsStateHistoryRoot1);
    expect(repostsStateHistoryState1).not.toEqual(repostsStateHistoryRoot);

    console.log('Reposted 1st post');

    // ==============================================================================
    // 4. Publishes on-chain proof for deleting the repost of the 1st post.
    // ==============================================================================

    const blockHeight3 = Field(2);

    // Prepare inputs to create a valid state transition
    const valid3 = createRepostDeletionTransitionValidInputs(
      valid2.targetState,
      user2Key,
      allRepostsCounter1,
      valid2.repostState,
      blockHeight3,
      postsMap,
      usersRepostsCountersMap,
      targetsRepostsCountersMap,
      repostsMap
    );

    // Create a valid state transition
    const transition3 = RepostsTransition.createRepostDeletionTransition(
      valid3.signature,
      valid3.targets,
      valid3.targetState,
      valid3.targetWitness,
      valid3.allRepostsCounter,
      valid3.usersRepostsCounters,
      valid3.targetsRepostsCounters,
      valid3.initialReposts,
      valid3.latestReposts,
      valid3.initialRepostState,
      valid3.repostWitness,
      valid3.latestRepostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    let proof3: any;
    if (PROOFS_ENABLED) {
      proof3 = await Reposts.proveRepostDeletionTransition(
        transition3,
        valid3.signature,
        valid3.targets,
        valid3.targetState,
        valid3.targetWitness,
        valid3.allRepostsCounter,
        valid3.usersRepostsCounters,
        valid3.targetsRepostsCounters,
        valid3.initialReposts,
        valid3.latestReposts,
        valid3.initialRepostState,
        valid3.repostWitness,
        valid3.latestRepostState.deletionBlockHeight
      );
    } else {
        proof3 = {
          verify: () => {},
          publicInput: {
            targets: transition3.targets,
            blockHeight: transition3.blockHeight,
            initialAllRepostsCounter: transition3.initialAllRepostsCounter,
            latestAllRepostsCounter: transition3.latestAllRepostsCounter,
            initialUsersRepostsCounters: transition3.initialUsersRepostsCounters,
            latestUsersRepostsCounters: transition3.latestUsersRepostsCounters,
            initialTargetsRepostsCounters: transition3.initialTargetsRepostsCounters,
            latestTargetsRepostsCounters: transition3.latestTargetsRepostsCounters,
            initialReposts: transition3.initialReposts,
            latestReposts: transition3.latestReposts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const repostsStateHistoryWitness2 = repostsStateHistoryMap.getWitness(blockHeight3);
    const repostsLatestState2 = Poseidon.hash([
      transition3.latestAllRepostsCounter,
      transition3.latestUsersRepostsCounters,
      transition3.latestTargetsRepostsCounters,
      transition3.latestReposts
    ]);
    repostsStateHistoryMap.set(blockHeight3, repostsLatestState2);
    const txn3 = await Mina.transaction(user1Address, async () => {
      repostsContract.update(proof3, repostsStateHistoryWitness2);
    });
    await txn3.prove();
    await txn3.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(3));

    const allRepostsCounterState2 = repostsContract.allRepostsCounter.get();
    const usersRepostsCountersState2 = repostsContract.usersRepostsCounters.get();
    const targetsRepostsCountersState2 = repostsContract.targetsRepostsCounters.get();
    const repostsState2 = repostsContract.reposts.get();
    const repostsLastUpdateState2 = repostsContract.lastUpdate.get();
    const repostsStateHistoryState2 = repostsContract.stateHistory.get();

    const usersRepostsCountersRoot2 = usersRepostsCountersMap.getRoot();
    const targetsRepostsCountersRoot2 = targetsRepostsCountersMap.getRoot();
    const repostsRoot2 = repostsMap.getRoot();
    const repostsStateHistoryRoot2 = repostsStateHistoryMap.getRoot();

    expect(allRepostsCounterState2).toEqual(Field(1));
    expect(usersRepostsCountersState2).toEqual(usersRepostsCountersRoot2);
    expect(usersRepostsCountersState2).toEqual(usersRepostsCountersRoot1);
    expect(targetsRepostsCountersState2).toEqual(targetsRepostsCountersRoot2);
    expect(targetsRepostsCountersState2).toEqual(targetsRepostsCountersRoot1);
    expect(repostsState2).toEqual(repostsRoot2);
    expect(repostsState2).not.toEqual(repostsRoot1);
    expect(repostsLastUpdateState2).toEqual(blockHeight3);
    expect(repostsStateHistoryState2).toEqual(repostsStateHistoryRoot2);
    expect(repostsStateHistoryState2).not.toEqual(repostsStateHistoryRoot1);

    console.log('Repost for 1st post deleted');

    // ==============================================================================
    // 5. Publishes on-chain proof for restoring the repost of the 1st post.
    // ==============================================================================

    const blockHeight4 = Field(3);

    // Prepare inputs to create a valid state transition
    const valid4 = createRepostRestorationTransitionValidInputs(
      valid3.targetState,
      user2Key,
      allRepostsCounter1,
      valid3.latestRepostState,
      blockHeight4,
      postsMap,
      usersRepostsCountersMap,
      targetsRepostsCountersMap,
      repostsMap
    );

    // Create a valid state transition
    const transition4 = RepostsTransition.createRepostRestorationTransition(
      valid4.signature,
      valid4.targets,
      valid4.targetState,
      valid4.targetWitness,
      valid4.allRepostsCounter,
      valid4.usersRepostsCounters,
      valid4.targetsRepostsCounters,
      valid4.initialReposts,
      valid4.latestReposts,
      valid4.initialRepostState,
      valid4.repostWitness,
      valid4.latestRepostState.restorationBlockHeight
    );

    // Create valid proof for our state transition
    let proof4: any;
    if (PROOFS_ENABLED) {
      proof4 = await Reposts.proveRepostRestorationTransition(
        transition4,
        valid4.signature,
        valid4.targets,
        valid4.targetState,
        valid4.targetWitness,
        valid4.allRepostsCounter,
        valid4.usersRepostsCounters,
        valid4.targetsRepostsCounters,
        valid4.initialReposts,
        valid4.latestReposts,
        valid4.initialRepostState,
        valid4.repostWitness,
        valid4.latestRepostState.restorationBlockHeight
      );
    } else {
        proof4 = {
          verify: () => {},
          publicInput: {
            targets: transition4.targets,
            blockHeight: transition4.blockHeight,
            initialAllRepostsCounter: transition4.initialAllRepostsCounter,
            latestAllRepostsCounter: transition4.latestAllRepostsCounter,
            initialUsersRepostsCounters: transition4.initialUsersRepostsCounters,
            latestUsersRepostsCounters: transition4.latestUsersRepostsCounters,
            initialTargetsRepostsCounters: transition4.initialTargetsRepostsCounters,
            latestTargetsRepostsCounters: transition4.latestTargetsRepostsCounters,
            initialReposts: transition4.initialReposts,
            latestReposts: transition4.latestReposts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const repostsStateHistoryWitness3 = repostsStateHistoryMap.getWitness(blockHeight4);
    const repostsLatestState3 = Poseidon.hash([
      transition4.latestAllRepostsCounter,
      transition4.latestUsersRepostsCounters,
      transition4.latestTargetsRepostsCounters,
      transition4.latestReposts
    ]);
    repostsStateHistoryMap.set(blockHeight4, repostsLatestState3);
    const txn4 = await Mina.transaction(user1Address, async () => {
      repostsContract.update(proof4, repostsStateHistoryWitness3);
    });
    await txn4.prove();
    await txn4.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(4));

    const allRepostsCounterState3 = repostsContract.allRepostsCounter.get();
    const usersRepostsCountersState3 = repostsContract.usersRepostsCounters.get();
    const targetsRepostsCountersState3 = repostsContract.targetsRepostsCounters.get();
    const repostsState3 = repostsContract.reposts.get();
    const repostsLastUpdateState3 = repostsContract.lastUpdate.get();
    const repostsStateHistoryState3 = repostsContract.stateHistory.get();

    const usersRepostsCountersRoot3 = usersRepostsCountersMap.getRoot();
    const targetsRepostsCountersRoot3 = targetsRepostsCountersMap.getRoot();
    const repostsRoot3 = repostsMap.getRoot();
    const repostsStateHistoryRoot3 = repostsStateHistoryMap.getRoot();

    expect(allRepostsCounterState3).toEqual(Field(1));
    expect(usersRepostsCountersState3).toEqual(usersRepostsCountersRoot3);
    expect(usersRepostsCountersState3).toEqual(usersRepostsCountersRoot2);
    expect(targetsRepostsCountersState3).toEqual(targetsRepostsCountersRoot3);
    expect(targetsRepostsCountersState3).toEqual(targetsRepostsCountersRoot2);
    expect(repostsState3).toEqual(repostsRoot3);
    expect(repostsState3).not.toEqual(repostsRoot2);
    expect(repostsLastUpdateState3).toEqual(blockHeight4);
    expect(repostsStateHistoryState3).toEqual(repostsStateHistoryRoot3);
    expect(repostsStateHistoryState3).not.toEqual(repostsStateHistoryRoot2);

    console.log('Repost of 1st post restored');

    // ==============================================================================
    // 6. Publishes on-chain proof (from merged proofs) for 2 new reposts of
    //    the 1st post.
    // ==============================================================================

    const allRepostsCounter2 = Field(2);
    const userRepostsCounter2 = Field(1);
    const targetRepostsCounter2 = Field(2);
    const blockHeight5 = Field(4);

    // Prepare inputs to create a valid state transition
    const valid5 = createRepostTransitionValidInputs(
      valid1.postState,
      user1Address,
      user1Key,
      allRepostsCounter2,
      userRepostsCounter2,
      targetRepostsCounter2,
      blockHeight5,
      postsMap,
      usersRepostsCountersMap,
      targetsRepostsCountersMap,
      repostsMap
    );

    // Create a valid state transition
    const transition5 = RepostsTransition.createRepostPublishingTransition(
      valid5.signature,
      valid5.targets,
      valid5.targetState,
      valid5.targetWitness,
      valid5.repostState.allRepostsCounter.sub(1),
      valid5.initialUsersRepostsCounters,
      valid5.latestUsersRepostsCounters,
      valid5.repostState.userRepostsCounter.sub(1),
      valid5.userRepostsCounterWitness,
      valid5.initialTargetsRepostsCounters,
      valid5.latestTargetsRepostsCounters,
      valid5.repostState.targetRepostsCounter.sub(1),
      valid5.targetRepostsCounterWitness,
      valid5.initialReposts,
      valid5.latestReposts,
      valid5.repostWitness,
      valid5.repostState
    );

    // Create valid proof for our state transition
    let proof5: any;
    if (PROOFS_ENABLED) {
      proof5 = await Reposts.proveRepostPublishingTransition(
        transition5,
        valid5.signature,
        valid5.targets,
        valid5.targetState,
        valid5.targetWitness,
        valid5.repostState.allRepostsCounter.sub(1),
        valid5.initialUsersRepostsCounters,
        valid5.latestUsersRepostsCounters,
        valid5.repostState.userRepostsCounter.sub(1),
        valid5.userRepostsCounterWitness,
        valid5.initialTargetsRepostsCounters,
        valid5.latestTargetsRepostsCounters,
        valid5.repostState.targetRepostsCounter.sub(1),
        valid5.targetRepostsCounterWitness,
        valid5.initialReposts,
        valid5.latestReposts,
        valid5.repostWitness,
        valid5.repostState
      );
    } else {
        proof5 = {
          verify: () => {},
          publicInput: {
            targets: transition5.targets,
            blockHeight: transition5.blockHeight,
            initialAllRepostsCounter: transition5.initialAllRepostsCounter,
            latestAllRepostsCounter: transition5.latestAllRepostsCounter,
            initialUsersRepostsCounters: transition5.initialUsersRepostsCounters,
            latestUsersRepostsCounters: transition5.latestUsersRepostsCounters,
            initialTargetsRepostsCounters: transition5.initialTargetsRepostsCounters,
            latestTargetsRepostsCounters: transition5.latestTargetsRepostsCounters,
            initialReposts: transition5.initialReposts,
            latestReposts: transition5.latestReposts
          }
        };
    }

    const allRepostsCounter3 = Field(3);
    const userRepostsCounter3 = Field(1);
    const targetRepostsCounter3 = Field(3);

    // Prepare inputs to create a valid state transition
    const valid6 = createRepostTransitionValidInputs(
      valid1.postState,
      user3Address,
      user3Key,
      allRepostsCounter3,
      userRepostsCounter3,
      targetRepostsCounter3,
      blockHeight5,
      postsMap,
      usersRepostsCountersMap,
      targetsRepostsCountersMap,
      repostsMap
    );

    // Create a valid state transition
    const transition6 = RepostsTransition.createRepostPublishingTransition(
      valid6.signature,
      valid6.targets,
      valid6.targetState,
      valid6.targetWitness,
      valid6.repostState.allRepostsCounter.sub(1),
      valid6.initialUsersRepostsCounters,
      valid6.latestUsersRepostsCounters,
      valid6.repostState.userRepostsCounter.sub(1),
      valid6.userRepostsCounterWitness,
      valid6.initialTargetsRepostsCounters,
      valid6.latestTargetsRepostsCounters,
      valid6.repostState.targetRepostsCounter.sub(1),
      valid6.targetRepostsCounterWitness,
      valid6.initialReposts,
      valid6.latestReposts,
      valid6.repostWitness,
      valid6.repostState
    );

    // Create valid proof for our state transition
    let proof6: any;
    if (PROOFS_ENABLED) {
      proof6 = await Reposts.proveRepostPublishingTransition(
        transition6,
        valid6.signature,
        valid6.targets,
        valid6.targetState,
        valid6.targetWitness,
        valid6.repostState.allRepostsCounter.sub(1),
        valid6.initialUsersRepostsCounters,
        valid6.latestUsersRepostsCounters,
        valid6.repostState.userRepostsCounter.sub(1),
        valid6.userRepostsCounterWitness,
        valid6.initialTargetsRepostsCounters,
        valid6.latestTargetsRepostsCounters,
        valid6.repostState.targetRepostsCounter.sub(1),
        valid6.targetRepostsCounterWitness,
        valid6.initialReposts,
        valid6.latestReposts,
        valid6.repostWitness,
        valid6.repostState
      );
    } else {
        proof6 = {
          verify: () => {},
          publicInput: {
            targets: transition6.targets,
            blockHeight: transition6.blockHeight,
            initialAllRepostsCounter: transition6.initialAllRepostsCounter,
            latestAllRepostsCounter: transition6.latestAllRepostsCounter,
            initialUsersRepostsCounters: transition6.initialUsersRepostsCounters,
            latestUsersRepostsCounters: transition6.latestUsersRepostsCounters,
            initialTargetsRepostsCounters: transition6.initialTargetsRepostsCounters,
            latestTargetsRepostsCounters: transition6.latestTargetsRepostsCounters,
            initialReposts: transition6.initialReposts,
            latestReposts: transition6.latestReposts
          }
        };
    }

    // Merge valid state transitions
    const mergedTransitions1 = RepostsTransition.mergeRepostsTransitions(
      transition5,
      transition6
    );

    // Create proof of valid merged state transitions
    let mergedTransitionProofs1: any;
    if (PROOFS_ENABLED) {
      mergedTransitionProofs1 =
        await Reposts.proveMergedRepostsTransitions(
          mergedTransitions1,
          proof5,
          proof6
        );
    } else {
        mergedTransitionProofs1 = {
          verify: () => {},
          publicInput: {
            targets: mergedTransitions1.targets,
            blockHeight: mergedTransitions1.blockHeight,
            initialAllRepostsCounter: mergedTransitions1.initialAllRepostsCounter,
            latestAllRepostsCounter: mergedTransitions1.latestAllRepostsCounter,
            initialUsersRepostsCounters: mergedTransitions1.initialUsersRepostsCounters,
            latestUsersRepostsCounters: mergedTransitions1.latestUsersRepostsCounters,
            initialTargetsRepostsCounters: mergedTransitions1.initialTargetsRepostsCounters,
            latestTargetsRepostsCounters: mergedTransitions1.latestTargetsRepostsCounters,
            initialReposts: mergedTransitions1.initialReposts,
            latestReposts: mergedTransitions1.latestReposts
          }
        };
    }

    // Send valid proof to update our on-chain state
    const repostsStateHistoryWitness4 = repostsStateHistoryMap.getWitness(blockHeight5);
    const repostsLatestState4 = Poseidon.hash([
      mergedTransitions1.latestAllRepostsCounter,
      mergedTransitions1.latestUsersRepostsCounters,
      mergedTransitions1.latestTargetsRepostsCounters,
      mergedTransitions1.latestReposts
    ]);
    repostsStateHistoryMap.set(blockHeight5, repostsLatestState4);
    const txn5 = await Mina.transaction(user1Address, async () => {
      repostsContract.update(mergedTransitionProofs1, repostsStateHistoryWitness4);
    });
    await txn5.prove();
    await txn5.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(5));

    const allRepostsCounterState4 = repostsContract.allRepostsCounter.get();
    const usersRepostsCountersState4 = repostsContract.usersRepostsCounters.get();
    const targetsRepostsCountersState4 = repostsContract.targetsRepostsCounters.get();
    const repostsState4 = repostsContract.reposts.get();
    const repostsLastUpdateState4 = repostsContract.lastUpdate.get();
    const repostsStateHistoryState4 = repostsContract.stateHistory.get();

    const usersRepostsCountersRoot4 = usersRepostsCountersMap.getRoot();
    const targetsRepostsCountersRoot4 = targetsRepostsCountersMap.getRoot();
    const repostsRoot4 = repostsMap.getRoot();
    const repostsStateHistoryRoot4 = repostsStateHistoryMap.getRoot();

    expect(allRepostsCounterState4).toEqual(Field(3));
    expect(usersRepostsCountersState4).toEqual(usersRepostsCountersRoot4);
    expect(usersRepostsCountersState4).not.toEqual(usersRepostsCountersRoot3);
    expect(targetsRepostsCountersState4).toEqual(targetsRepostsCountersRoot4);
    expect(targetsRepostsCountersState4).not.toEqual(targetsRepostsCountersRoot3);
    expect(repostsState4).toEqual(repostsRoot4);
    expect(repostsState4).not.toEqual(repostsRoot3);
    expect(repostsLastUpdateState4).toEqual(blockHeight5);
    expect(repostsStateHistoryState4).toEqual(repostsStateHistoryRoot4);
    expect(repostsStateHistoryState4).not.toEqual(repostsStateHistoryRoot3);

    console.log('2nd and 3rd reposts published through merged proofs');

    // ==============================================================================
    // 7. Extra validation for all the state updates so far.
    // ==============================================================================

    const newUsersRepostsCountersMap = new MerkleMap();
    const user1AddressAsField = Poseidon.hash(user1Address.toFields());
    const user2AddressAsField = Poseidon.hash(user2Address.toFields());
    const user3AddressAsField = Poseidon.hash(user3Address.toFields());
    newUsersRepostsCountersMap.set(user1AddressAsField, Field(1));
    newUsersRepostsCountersMap.set(user2AddressAsField, Field(1));
    newUsersRepostsCountersMap.set(user3AddressAsField, Field(1));
    expect(newUsersRepostsCountersMap.getRoot()).toEqual(usersRepostsCountersState4);

    const newTargetsRepostsCountersMap = new MerkleMap();
    newTargetsRepostsCountersMap.set(valid2.repostState.targetKey, Field(3));
    expect(newTargetsRepostsCountersMap.getRoot()).toEqual(targetsRepostsCountersState4);

    const repost1 = new RepostState({
      isTargetPost: valid4.latestRepostState.isTargetPost,
      targetKey: valid4.latestRepostState.targetKey,
      reposterAddress: valid4.latestRepostState.reposterAddress,
      allRepostsCounter: valid4.latestRepostState.allRepostsCounter,
      userRepostsCounter: valid4.latestRepostState.userRepostsCounter,
      targetRepostsCounter: valid4.latestRepostState.targetRepostsCounter,
      repostBlockHeight: valid4.latestRepostState.repostBlockHeight,
      deletionBlockHeight: valid4.latestRepostState.deletionBlockHeight,
      restorationBlockHeight: valid4.latestRepostState.restorationBlockHeight,
    });

    const repost2 = new RepostState({
      isTargetPost: valid5.repostState.isTargetPost,
      targetKey: valid5.repostState.targetKey,
      reposterAddress: valid5.repostState.reposterAddress,
      allRepostsCounter: valid5.repostState.allRepostsCounter,
      userRepostsCounter: valid5.repostState.userRepostsCounter,
      targetRepostsCounter: valid5.repostState.targetRepostsCounter,
      repostBlockHeight: valid5.repostState.repostBlockHeight,
      deletionBlockHeight: valid5.repostState.deletionBlockHeight,
      restorationBlockHeight: valid5.repostState.restorationBlockHeight,
    });

    const repost3 = new RepostState({
      isTargetPost: valid6.repostState.isTargetPost,
      targetKey: valid6.repostState.targetKey,
      reposterAddress: valid6.repostState.reposterAddress,
      allRepostsCounter: valid6.repostState.allRepostsCounter,
      userRepostsCounter: valid6.repostState.userRepostsCounter,
      targetRepostsCounter: valid6.repostState.targetRepostsCounter,
      repostBlockHeight: valid6.repostState.repostBlockHeight,
      deletionBlockHeight: valid6.repostState.deletionBlockHeight,
      restorationBlockHeight: valid6.repostState.restorationBlockHeight,
    });

    const newRepostsMap = new MerkleMap();

    const repost1Key = Poseidon.hash([
      valid4.latestRepostState.targetKey,
      user2AddressAsField
    ]);
    newRepostsMap.set(repost1Key, repost1.hash());

    const repost2Key = Poseidon.hash([
      valid5.repostState.targetKey,
      user1AddressAsField
    ]);
    newRepostsMap.set(repost2Key, repost2.hash());

    const repost3Key = Poseidon.hash([
      valid6.repostState.targetKey,
      user3AddressAsField
    ]);
    newRepostsMap.set(repost3Key, repost3.hash());

    expect(newRepostsMap.getRoot()).toEqual(repostsState4);

    console.log('Successful extra validation of all the state updates');
  });
});
