import { PostsContract } from '../posts/PostsContract';
import { PostsTransition, Posts } from '../posts/Posts';
import { ReactionsContract } from './ReactionsContract';
import { ReactionsTransition, Reactions, ReactionState } from './Reactions';
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
  deployReactionsContract,
  createReactionTransitionValidInputs,
  createReactionDeletionTransitionValidInputs,
  createReactionRestorationTransitionValidInputs,
} from './ReactionsUtils';
import * as dotenv from 'dotenv';

dotenv.config();
const PROOFS_ENABLED = process.env.PROOFS_ENABLED === 'true' || false;

describe(`the ReactionsContract and the Reactions ZkProgram`, () => {
  let Local: any,
    user1Address: PublicKey,
    user1Key: PrivateKey,
    user2Address: PublicKey,
    user2Key: PrivateKey,
    postsContractAddress: PublicKey,
    postsContractKey: PrivateKey,
    postsContract: PostsContract,
    usersPostsCountersMap: MerkleMap,
    postsMap: MerkleMap,
    stateHistoryMap: MerkleMap,
    reactionsContractAddress: PublicKey,
    reactionsContractKey: PrivateKey,
    reactionsContract: ReactionsContract,
    usersReactionsCountersMap: MerkleMap,
    targetsReactionsCountersMap: MerkleMap,
    reactionsMap: MerkleMap;

  beforeAll(async () => {
    if (PROOFS_ENABLED) {
      console.log('Compiling Posts ZkProgram...');
      await Posts.compile();
      console.log('Compiling PostsContract...');
      await PostsContract.compile();
      console.log('Compiling Reactions ZkProgram...');
      await Reactions.compile();
      console.log('Compiling ReactionsContract...');
      await ReactionsContract.compile();
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

    const reactionsConfig = configJson.deployAliases['reactions'];
    const reactionsContractKeyBase58: { privateKey: string } = JSON.parse(
      await fs.readFile(reactionsConfig.keyPath, 'utf8')
    );
    reactionsContractKey = PrivateKey.fromBase58(
      reactionsContractKeyBase58.privateKey
    );
    reactionsContractAddress = reactionsContractKey.toPublicKey();
    reactionsContract = new ReactionsContract(reactionsContractAddress);
    usersReactionsCountersMap = new MerkleMap();
    targetsReactionsCountersMap = new MerkleMap();
    reactionsMap = new MerkleMap();
  });

  test(`ReactionsContract and Reactions zkProgram functionality`, async () => {
    // ==============================================================================
    // 1. Deploys PostsContract and ReactionsContract.
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

    await deployReactionsContract(
      user1Address,
      user1Key,
      reactionsContract,
      reactionsContractKey
    );

    // Validate expected state
    const allReactionsCounterState =
      reactionsContract.allReactionsCounter.get();
    const usersReactionsCountersState =
      reactionsContract.usersReactionsCounters.get();
    const targetsReactionsCountersState =
      reactionsContract.targetsReactionsCounters.get();
    const reactionsState = reactionsContract.reactions.get();
    const usersReactionsCountersRoot = usersReactionsCountersMap.getRoot();
    const targetsReactionsCountersRoot = targetsReactionsCountersMap.getRoot();
    const reactionsRoot = reactionsMap.getRoot();
    expect(allReactionsCounterState).toEqual(Field(0));
    expect(usersReactionsCountersState).toEqual(usersReactionsCountersRoot);
    expect(targetsReactionsCountersState).toEqual(targetsReactionsCountersRoot);
    expect(reactionsState).toEqual(reactionsRoot);

    console.log('ReactionsContract deployed');

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
    const stateHistoryWitness1 = stateHistoryMap.getWitness(Field(0));
    const latestState1 = Poseidon.hash([
      transition1.latestAllPostsCounter,
      transition1.latestUsersPostsCounters,
      transition1.latestPosts
    ]);
    stateHistoryMap.set(Field(0), latestState1);
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
    // 3. Publishes on-chain proof for reacting to the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid2 = createReactionTransitionValidInputs(
      valid1.postState,
      user2Address,
      user2Key,
      Field(10084),
      Field(1),
      Field(1),
      Field(1),
      Field(1),
      postsMap,
      usersReactionsCountersMap,
      targetsReactionsCountersMap,
      reactionsMap
    );

    // Create a valid state transition
    const transition2 = ReactionsTransition.createReactionPublishingTransition(
      valid2.signature,
      valid2.targets,
      valid2.targetState,
      valid2.targetWitness,
      valid2.reactionState.allReactionsCounter.sub(1),
      valid2.initialUsersReactionsCounters,
      valid2.latestUsersReactionsCounters,
      valid2.reactionState.userReactionsCounter.sub(1),
      valid2.userReactionsCounterWitness,
      valid2.initialTargetsReactionsCounters,
      valid2.latestTargetsReactionsCounters,
      valid2.reactionState.targetReactionsCounter.sub(1),
      valid2.targetReactionsCounterWitness,
      valid2.initialReactions,
      valid2.latestReactions,
      valid2.reactionWitness,
      valid2.reactionState
    );

    // Create valid proof for our state transition
    let proof2: any;
    if (PROOFS_ENABLED) {
      proof2 = await Reactions.proveReactionPublishingTransition(
        transition2,
        valid2.signature,
        valid2.targets,
        valid2.targetState,
        valid2.targetWitness,
        valid2.reactionState.allReactionsCounter.sub(1),
        valid2.initialUsersReactionsCounters,
        valid2.latestUsersReactionsCounters,
        valid2.reactionState.userReactionsCounter.sub(1),
        valid2.userReactionsCounterWitness,
        valid2.initialTargetsReactionsCounters,
        valid2.latestTargetsReactionsCounters,
        valid2.reactionState.targetReactionsCounter.sub(1),
        valid2.targetReactionsCounterWitness,
        valid2.initialReactions,
        valid2.latestReactions,
        valid2.reactionWitness,
        valid2.reactionState
      );
    } else {
        proof2 = {
          verify: () => {},
          publicInput: {
            targets: transition2.targets,
            blockHeight: transition2.blockHeight,
            initialAllReactionsCounter: transition2.initialAllReactionsCounter,
            latestAllReactionsCounter: transition2.latestAllReactionsCounter,
            initialUsersReactionsCounters: transition2.initialUsersReactionsCounters,
            latestUsersReactionsCounters: transition2.latestUsersReactionsCounters,
            initialTargetsReactionsCounters: transition2.initialTargetsReactionsCounters,
            latestTargetsReactionsCounters: transition2.latestTargetsReactionsCounters,
            initialReactions: transition2.initialReactions,
            latestReactions: transition2.latestReactions
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn2 = await Mina.transaction(user1Address, async () => {
      reactionsContract.update(proof2);
    });
    await txn2.prove();
    await txn2.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(2));

    const allReactionsCounterState1 =
      reactionsContract.allReactionsCounter.get();
    const usersReactionsCountersState1 =
      reactionsContract.usersReactionsCounters.get();
    const targetsReactionsCountersState1 =
      reactionsContract.targetsReactionsCounters.get();
    const reactionsState1 = reactionsContract.reactions.get();
    const usersReactionsCountersRoot1 = usersReactionsCountersMap.getRoot();
    const targetsReactionsCountersRoot1 = targetsReactionsCountersMap.getRoot();
    const reactionsRoot1 = reactionsMap.getRoot();
    expect(allReactionsCounterState1).toEqual(Field(1));
    expect(usersReactionsCountersState1).toEqual(usersReactionsCountersRoot1);
    expect(usersReactionsCountersState1).not.toEqual(
      usersReactionsCountersRoot
    );
    expect(targetsReactionsCountersState1).toEqual(
      targetsReactionsCountersRoot1
    );
    expect(targetsReactionsCountersState1).not.toEqual(
      targetsReactionsCountersRoot
    );
    expect(reactionsState1).toEqual(reactionsRoot1);
    expect(reactionsState1).not.toEqual(reactionsRoot);

    console.log('Reacted to 1st post');

    // ==============================================================================
    // 4. Publishes on-chain proof for deleting the reaction to the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid3 = createReactionDeletionTransitionValidInputs(
      valid2.targetState,
      user2Key,
      Field(1),
      valid2.reactionState,
      Field(2),
      postsMap,
      usersReactionsCountersMap,
      targetsReactionsCountersMap,
      reactionsMap
    );

    // Create a valid state transition
    const transition3 = ReactionsTransition.createReactionDeletionTransition(
      valid3.signature,
      valid3.targets,
      valid3.targetState,
      valid3.targetWitness,
      valid3.allReactionsCounter,
      valid3.usersReactionsCounters,
      valid3.targetsReactionsCounters,
      valid3.initialReactions,
      valid3.latestReactions,
      valid3.initialReactionState,
      valid3.reactionWitness,
      valid3.latestReactionState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    let proof3: any;
    if (PROOFS_ENABLED) {
      proof3 = await Reactions.proveReactionDeletionTransition(
        transition3,
        valid3.signature,
        valid3.targets,
        valid3.targetState,
        valid3.targetWitness,
        valid3.allReactionsCounter,
        valid3.usersReactionsCounters,
        valid3.targetsReactionsCounters,
        valid3.initialReactions,
        valid3.latestReactions,
        valid3.initialReactionState,
        valid3.reactionWitness,
        valid3.latestReactionState.deletionBlockHeight
      );
    } else {
        proof3 = {
          verify: () => {},
          publicInput: {
            targets: transition3.targets,
            blockHeight: transition3.blockHeight,
            initialAllReactionsCounter: transition3.initialAllReactionsCounter,
            latestAllReactionsCounter: transition3.latestAllReactionsCounter,
            initialUsersReactionsCounters: transition3.initialUsersReactionsCounters,
            latestUsersReactionsCounters: transition3.latestUsersReactionsCounters,
            initialTargetsReactionsCounters: transition3.initialTargetsReactionsCounters,
            latestTargetsReactionsCounters: transition3.latestTargetsReactionsCounters,
            initialReactions: transition3.initialReactions,
            latestReactions: transition3.latestReactions
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn3 = await Mina.transaction(user1Address, async () => {
      reactionsContract.update(proof3);
    });
    await txn3.prove();
    await txn3.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(3));

    const allReactionsCounterState2 =
      reactionsContract.allReactionsCounter.get();
    const usersReactionsCountersState2 =
      reactionsContract.usersReactionsCounters.get();
    const targetsReactionsCountersState2 =
      reactionsContract.targetsReactionsCounters.get();
    const reactionsState2 = reactionsContract.reactions.get();
    const usersReactionsCountersRoot2 = usersReactionsCountersMap.getRoot();
    const targetsReactionsCountersRoot2 = targetsReactionsCountersMap.getRoot();
    const reactionsRoot2 = reactionsMap.getRoot();
    expect(allReactionsCounterState2).toEqual(Field(1));
    expect(usersReactionsCountersState2).toEqual(usersReactionsCountersRoot2);
    expect(usersReactionsCountersState2).toEqual(usersReactionsCountersRoot1);
    expect(targetsReactionsCountersState2).toEqual(
      targetsReactionsCountersRoot2
    );
    expect(targetsReactionsCountersState2).toEqual(
      targetsReactionsCountersRoot1
    );
    expect(reactionsState2).toEqual(reactionsRoot2);
    expect(reactionsState2).not.toEqual(reactionsRoot1);

    console.log('Reaction to 1st post deleted');

    // ==============================================================================
    // 5. Publishes on-chain proof for restoring the reaction to the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid4 = createReactionRestorationTransitionValidInputs(
      valid3.targetState,
      user2Key,
      Field(1),
      valid3.latestReactionState,
      Field(3),
      postsMap,
      usersReactionsCountersMap,
      targetsReactionsCountersMap,
      reactionsMap
    );

    // Create a valid state transition
    const transition4 = ReactionsTransition.createReactionRestorationTransition(
      valid4.signature,
      valid4.targets,
      valid4.targetState,
      valid4.targetWitness,
      valid4.allReactionsCounter,
      valid4.usersReactionsCounters,
      valid4.targetsReactionsCounters,
      valid4.initialReactions,
      valid4.latestReactions,
      valid4.initialReactionState,
      valid4.reactionWitness,
      valid4.latestReactionState.restorationBlockHeight
    );

    // Create valid proof for our state transition
    let proof4: any;
    if (PROOFS_ENABLED) {
      proof4 = await Reactions.proveReactionRestorationTransition(
        transition4,
        valid4.signature,
        valid4.targets,
        valid4.targetState,
        valid4.targetWitness,
        valid4.allReactionsCounter,
        valid4.usersReactionsCounters,
        valid4.targetsReactionsCounters,
        valid4.initialReactions,
        valid4.latestReactions,
        valid4.initialReactionState,
        valid4.reactionWitness,
        valid4.latestReactionState.restorationBlockHeight
      );
    } else {
        proof4 = {
          verify: () => {},
          publicInput: {
            targets: transition4.targets,
            blockHeight: transition4.blockHeight,
            initialAllReactionsCounter: transition4.initialAllReactionsCounter,
            latestAllReactionsCounter: transition4.latestAllReactionsCounter,
            initialUsersReactionsCounters: transition4.initialUsersReactionsCounters,
            latestUsersReactionsCounters: transition4.latestUsersReactionsCounters,
            initialTargetsReactionsCounters: transition4.initialTargetsReactionsCounters,
            latestTargetsReactionsCounters: transition4.latestTargetsReactionsCounters,
            initialReactions: transition4.initialReactions,
            latestReactions: transition4.latestReactions
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn4 = await Mina.transaction(user1Address, async () => {
      reactionsContract.update(proof4);
    });
    await txn4.prove();
    await txn4.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(4));

    const allReactionsCounterState3 =
      reactionsContract.allReactionsCounter.get();
    const usersReactionsCountersState3 =
      reactionsContract.usersReactionsCounters.get();
    const targetsReactionsCountersState3 =
      reactionsContract.targetsReactionsCounters.get();
    const reactionsState3 = reactionsContract.reactions.get();
    const usersReactionsCountersRoot3 = usersReactionsCountersMap.getRoot();
    const targetsReactionsCountersRoot3 = targetsReactionsCountersMap.getRoot();
    const reactionsRoot3 = reactionsMap.getRoot();
    expect(allReactionsCounterState3).toEqual(Field(1));
    expect(usersReactionsCountersState3).toEqual(usersReactionsCountersRoot3);
    expect(usersReactionsCountersState3).toEqual(usersReactionsCountersRoot2);
    expect(targetsReactionsCountersState3).toEqual(
      targetsReactionsCountersRoot3
    );
    expect(targetsReactionsCountersState3).toEqual(
      targetsReactionsCountersRoot2
    );
    expect(reactionsState3).toEqual(reactionsRoot3);
    expect(reactionsState3).not.toEqual(reactionsRoot2);

    console.log('Reaction to 1st post restored');

    // ==============================================================================
    // 6. Publishes on-chain proof (from merged proofs) for 2 new reactions to
    //    the 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid5 = createReactionTransitionValidInputs(
      valid1.postState,
      user1Address,
      user1Key,
      Field(128064),
      Field(2),
      Field(1),
      Field(2),
      Field(4),
      postsMap,
      usersReactionsCountersMap,
      targetsReactionsCountersMap,
      reactionsMap
    );

    // Create a valid state transition
    const transition5 = ReactionsTransition.createReactionPublishingTransition(
      valid5.signature,
      valid5.targets,
      valid5.targetState,
      valid5.targetWitness,
      valid5.reactionState.allReactionsCounter.sub(1),
      valid5.initialUsersReactionsCounters,
      valid5.latestUsersReactionsCounters,
      valid5.reactionState.userReactionsCounter.sub(1),
      valid5.userReactionsCounterWitness,
      valid5.initialTargetsReactionsCounters,
      valid5.latestTargetsReactionsCounters,
      valid5.reactionState.targetReactionsCounter.sub(1),
      valid5.targetReactionsCounterWitness,
      valid5.initialReactions,
      valid5.latestReactions,
      valid5.reactionWitness,
      valid5.reactionState
    );

    // Create valid proof for our state transition
    let proof5: any;
    if (PROOFS_ENABLED) {
      proof5 = await Reactions.proveReactionPublishingTransition(
        transition5,
        valid5.signature,
        valid5.targets,
        valid5.targetState,
        valid5.targetWitness,
        valid5.reactionState.allReactionsCounter.sub(1),
        valid5.initialUsersReactionsCounters,
        valid5.latestUsersReactionsCounters,
        valid5.reactionState.userReactionsCounter.sub(1),
        valid5.userReactionsCounterWitness,
        valid5.initialTargetsReactionsCounters,
        valid5.latestTargetsReactionsCounters,
        valid5.reactionState.targetReactionsCounter.sub(1),
        valid5.targetReactionsCounterWitness,
        valid5.initialReactions,
        valid5.latestReactions,
        valid5.reactionWitness,
        valid5.reactionState
      );
    } else {
        proof5 = {
          verify: () => {},
          publicInput: {
            targets: transition5.targets,
            blockHeight: transition5.blockHeight,
            initialAllReactionsCounter: transition5.initialAllReactionsCounter,
            latestAllReactionsCounter: transition5.latestAllReactionsCounter,
            initialUsersReactionsCounters: transition5.initialUsersReactionsCounters,
            latestUsersReactionsCounters: transition5.latestUsersReactionsCounters,
            initialTargetsReactionsCounters: transition5.initialTargetsReactionsCounters,
            latestTargetsReactionsCounters: transition5.latestTargetsReactionsCounters,
            initialReactions: transition5.initialReactions,
            latestReactions: transition5.latestReactions
          }
        };
    }

    // Prepare inputs to create a valid state transition
    const valid6 = createReactionTransitionValidInputs(
      valid1.postState,
      user2Address,
      user2Key,
      Field(129654),
      Field(3),
      Field(2),
      Field(3),
      Field(4),
      postsMap,
      usersReactionsCountersMap,
      targetsReactionsCountersMap,
      reactionsMap
    );

    // Create a valid state transition
    const transition6 = ReactionsTransition.createReactionPublishingTransition(
      valid6.signature,
      valid6.targets,
      valid6.targetState,
      valid6.targetWitness,
      valid6.reactionState.allReactionsCounter.sub(1),
      valid6.initialUsersReactionsCounters,
      valid6.latestUsersReactionsCounters,
      valid6.reactionState.userReactionsCounter.sub(1),
      valid6.userReactionsCounterWitness,
      valid6.initialTargetsReactionsCounters,
      valid6.latestTargetsReactionsCounters,
      valid6.reactionState.targetReactionsCounter.sub(1),
      valid6.targetReactionsCounterWitness,
      valid6.initialReactions,
      valid6.latestReactions,
      valid6.reactionWitness,
      valid6.reactionState
    );

    // Create valid proof for our state transition
    let proof6: any;
    if (PROOFS_ENABLED) {
      proof6 = await Reactions.proveReactionPublishingTransition(
        transition6,
        valid6.signature,
        valid6.targets,
        valid6.targetState,
        valid6.targetWitness,
        valid6.reactionState.allReactionsCounter.sub(1),
        valid6.initialUsersReactionsCounters,
        valid6.latestUsersReactionsCounters,
        valid6.reactionState.userReactionsCounter.sub(1),
        valid6.userReactionsCounterWitness,
        valid6.initialTargetsReactionsCounters,
        valid6.latestTargetsReactionsCounters,
        valid6.reactionState.targetReactionsCounter.sub(1),
        valid6.targetReactionsCounterWitness,
        valid6.initialReactions,
        valid6.latestReactions,
        valid6.reactionWitness,
        valid6.reactionState
      );
    } else {
        proof6 = {
          verify: () => {},
          publicInput: {
            targets: transition6.targets,
            blockHeight: transition6.blockHeight,
            initialAllReactionsCounter: transition6.initialAllReactionsCounter,
            latestAllReactionsCounter: transition6.latestAllReactionsCounter,
            initialUsersReactionsCounters: transition6.initialUsersReactionsCounters,
            latestUsersReactionsCounters: transition6.latestUsersReactionsCounters,
            initialTargetsReactionsCounters: transition6.initialTargetsReactionsCounters,
            latestTargetsReactionsCounters: transition6.latestTargetsReactionsCounters,
            initialReactions: transition6.initialReactions,
            latestReactions: transition6.latestReactions
          }
        };
    }

    // Merge valid state transitions
    const mergedTransitions1 = ReactionsTransition.mergeReactionsTransitions(
      transition5,
      transition6
    );

    // Create proof of valid merged state transitions
    let mergedTransitionProofs1: any;
    if (PROOFS_ENABLED) {
      mergedTransitionProofs1 =
        await Reactions.proveMergedReactionsTransitions(
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
            initialAllReactionsCounter: mergedTransitions1.initialAllReactionsCounter,
            latestAllReactionsCounter: mergedTransitions1.latestAllReactionsCounter,
            initialUsersReactionsCounters: mergedTransitions1.initialUsersReactionsCounters,
            latestUsersReactionsCounters: mergedTransitions1.latestUsersReactionsCounters,
            initialTargetsReactionsCounters: mergedTransitions1.initialTargetsReactionsCounters,
            latestTargetsReactionsCounters: mergedTransitions1.latestTargetsReactionsCounters,
            initialReactions: mergedTransitions1.initialReactions,
            latestReactions: mergedTransitions1.latestReactions
          }
        };
    }

    // Send valid proof to update our on-chain state
    const txn5 = await Mina.transaction(user1Address, async () => {
      reactionsContract.update(mergedTransitionProofs1);
    });
    await txn5.prove();
    await txn5.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(5));

    const allReactionsCounterState4 =
      reactionsContract.allReactionsCounter.get();
    const usersReactionsCountersState4 =
      reactionsContract.usersReactionsCounters.get();
    const targetsReactionsCountersState4 =
      reactionsContract.targetsReactionsCounters.get();
    const reactionsState4 = reactionsContract.reactions.get();
    const usersReactionsCountersRoot4 = usersReactionsCountersMap.getRoot();
    const targetsReactionsCountersRoot4 = targetsReactionsCountersMap.getRoot();
    const reactionsRoot4 = reactionsMap.getRoot();
    expect(allReactionsCounterState4).toEqual(Field(3));
    expect(usersReactionsCountersState4).toEqual(usersReactionsCountersRoot4);
    expect(usersReactionsCountersState4).not.toEqual(
      usersReactionsCountersRoot3
    );
    expect(targetsReactionsCountersState4).toEqual(
      targetsReactionsCountersRoot4
    );
    expect(targetsReactionsCountersState4).not.toEqual(
      targetsReactionsCountersRoot3
    );
    expect(reactionsState4).toEqual(reactionsRoot4);
    expect(reactionsState4).not.toEqual(reactionsRoot3);

    console.log('2nd and 3rd reactions published through merged proofs');

    // ==============================================================================
    // 7. Extra validation for all the state updates so far.
    // ==============================================================================

    const newUsersReactionsCountersMap = new MerkleMap();
    const user1AddressAsField = Poseidon.hash(user1Address.toFields());
    const user2AddressAsField = Poseidon.hash(user2Address.toFields());
    newUsersReactionsCountersMap.set(user1AddressAsField, Field(1));
    newUsersReactionsCountersMap.set(user2AddressAsField, Field(2));
    expect(newUsersReactionsCountersMap.getRoot()).toEqual(
      usersReactionsCountersState4
    );

    const newTargetsReactionsCountersMap = new MerkleMap();
    newTargetsReactionsCountersMap.set(
      valid2.reactionState.targetKey,
      Field(3)
    );
    expect(newTargetsReactionsCountersMap.getRoot()).toEqual(
      targetsReactionsCountersState4
    );

    const reaction1 = new ReactionState({
      isTargetPost: valid4.latestReactionState.isTargetPost,
      targetKey: valid4.latestReactionState.targetKey,
      reactorAddress: valid4.latestReactionState.reactorAddress,
      reactionCodePoint: valid4.latestReactionState.reactionCodePoint,
      allReactionsCounter: valid4.latestReactionState.allReactionsCounter,
      userReactionsCounter: valid4.latestReactionState.userReactionsCounter,
      targetReactionsCounter: valid4.latestReactionState.targetReactionsCounter,
      reactionBlockHeight: valid4.latestReactionState.reactionBlockHeight,
      deletionBlockHeight: valid4.latestReactionState.deletionBlockHeight,
      restorationBlockHeight: valid4.latestReactionState.restorationBlockHeight,
    });

    const reaction2 = new ReactionState({
      isTargetPost: valid5.reactionState.isTargetPost,
      targetKey: valid5.reactionState.targetKey,
      reactorAddress: valid5.reactionState.reactorAddress,
      reactionCodePoint: valid5.reactionState.reactionCodePoint,
      allReactionsCounter: valid5.reactionState.allReactionsCounter,
      userReactionsCounter: valid5.reactionState.userReactionsCounter,
      targetReactionsCounter: valid5.reactionState.targetReactionsCounter,
      reactionBlockHeight: valid5.reactionState.reactionBlockHeight,
      deletionBlockHeight: valid5.reactionState.deletionBlockHeight,
      restorationBlockHeight: valid5.reactionState.restorationBlockHeight,
    });

    const reaction3 = new ReactionState({
      isTargetPost: valid6.reactionState.isTargetPost,
      targetKey: valid6.reactionState.targetKey,
      reactorAddress: valid6.reactionState.reactorAddress,
      reactionCodePoint: valid6.reactionState.reactionCodePoint,
      allReactionsCounter: valid6.reactionState.allReactionsCounter,
      userReactionsCounter: valid6.reactionState.userReactionsCounter,
      targetReactionsCounter: valid6.reactionState.targetReactionsCounter,
      reactionBlockHeight: valid6.reactionState.reactionBlockHeight,
      deletionBlockHeight: valid6.reactionState.deletionBlockHeight,
      restorationBlockHeight: valid6.reactionState.restorationBlockHeight,
    });

    const newReactionsMap = new MerkleMap();

    const reaction1Key = Poseidon.hash([
      valid4.latestReactionState.targetKey,
      user2AddressAsField,
      valid4.latestReactionState.reactionCodePoint,
    ]);
    newReactionsMap.set(reaction1Key, reaction1.hash());

    const reaction2Key = Poseidon.hash([
      valid5.reactionState.targetKey,
      user1AddressAsField,
      valid5.reactionState.reactionCodePoint,
    ]);
    newReactionsMap.set(reaction2Key, reaction2.hash());

    const reaction3Key = Poseidon.hash([
      valid6.reactionState.targetKey,
      user2AddressAsField,
      valid6.reactionState.reactionCodePoint,
    ]);
    newReactionsMap.set(reaction3Key, reaction3.hash());

    expect(newReactionsMap.getRoot()).toEqual(reactionsState4);

    console.log('Successful extra validation of all the state updates');
  });
});
