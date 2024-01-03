import { PostsContract } from '../posts/PostsContract';
import { PostsTransition, PostState, Posts } from '../posts/Posts';
import { ReactionsContract } from './ReactionsContract';
import { ReactionsTransition, ReactionState, Reactions } from './Reactions';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  MerkleMap,
  CircuitString,
  Poseidon,
  Signature,
  UInt32,
  Bool,
} from 'o1js';
import { Config } from '../posts/PostsDeploy';
import fs from 'fs/promises';
import {
  deployPostsContract,
  createPostPublishingTransitionValidInputs,
} from '../posts/PostsUtils';

let proofsEnabled = true;

describe(`the ReactionsContract and the Reactions ZkProgram`, () => {
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
    reactionsContractAddress: PublicKey,
    reactionsContractKey: PrivateKey,
    reactionsContract: ReactionsContract,
    usersReactionsCountersMap: MerkleMap,
    targetsReactionsCountersMap: MerkleMap,
    reactionsMap: MerkleMap;

  beforeAll(async () => {
    if (proofsEnabled) {
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

  async function deployReactionsContract() {
    const txn = await Mina.transaction(user1Address, () => {
      AccountUpdate.fundNewAccount(user1Address);
      reactionsContract.deploy();
    });
    await txn.prove();
    await txn.sign([user1Key, reactionsContractKey]).send();
  }

  function createReactionTransitionValidInputs(
    targetState: PostState,
    reactorAddress: PublicKey,
    reactorKey: PrivateKey,
    reactionCodePoint: Field,
    allReactionsCounter: Field,
    userReactionsCounter: Field,
    targetReactionsCounter: Field,
    reactionBlockHeight: Field,
    postsMap: MerkleMap,
    usersReactionsCountersMap: MerkleMap,
    targetsReactionsCountersMap: MerkleMap,
    reactionsMap: MerkleMap
  ) {
    const posterAddressAsField = Poseidon.hash(
      targetState.posterAddress.toFields()
    );
    const postContentIDHash = targetState.postContentID.hash();
    const targetKey = Poseidon.hash([posterAddressAsField, postContentIDHash]);

    const signature = Signature.create(reactorKey, [
      targetKey,
      reactionCodePoint,
    ]);

    const targetWitness = postsMap.getWitness(
      Poseidon.hash([posterAddressAsField, postContentIDHash])
    );

    const initialUsersReactionsCounters = usersReactionsCountersMap.getRoot();
    const reactorAddressAsField = Poseidon.hash(reactorAddress.toFields());
    usersReactionsCountersMap.set(reactorAddressAsField, userReactionsCounter);
    const latestUsersReactionsCounters = usersReactionsCountersMap.getRoot();
    const userReactionsCounterWitness = usersReactionsCountersMap.getWitness(
      reactorAddressAsField
    );

    const initialTargetsReactionsCounters =
      targetsReactionsCountersMap.getRoot();
    targetsReactionsCountersMap.set(targetKey, targetReactionsCounter);
    const latestTargetsReactionsCounters =
      targetsReactionsCountersMap.getRoot();
    const targetReactionsCounterWitness =
      targetsReactionsCountersMap.getWitness(targetKey);

    const reactionState = new ReactionState({
      isTargetPost: new Bool(true),
      targetKey: targetKey,
      reactorAddress: reactorAddress,
      reactionCodePoint: reactionCodePoint,
      allReactionsCounter: allReactionsCounter,
      userReactionsCounter: userReactionsCounter,
      targetReactionsCounter: targetReactionsCounter,
      reactionBlockHeight: reactionBlockHeight,
      deletionBlockHeight: Field(0),
      restorationBlockHeight: Field(0),
    });

    const initialReactions = reactionsMap.getRoot();
    const reactionKey = Poseidon.hash([
      targetKey,
      reactorAddressAsField,
      reactionCodePoint,
    ]);
    reactionsMap.set(reactionKey, reactionState.hash());
    const latestReactions = reactionsMap.getRoot();
    const reactionWitness = reactionsMap.getWitness(reactionKey);

    return {
      signature: signature,
      targetState: targetState,
      targetWitness: targetWitness,
      initialUsersReactionsCounters: initialUsersReactionsCounters,
      latestUsersReactionsCounters: latestUsersReactionsCounters,
      userReactionsCounterWitness: userReactionsCounterWitness,
      initialTargetsReactionsCounters: initialTargetsReactionsCounters,
      latestTargetsReactionsCounters: latestTargetsReactionsCounters,
      targetReactionsCounterWitness: targetReactionsCounterWitness,
      initialReactions: initialReactions,
      latestReactions: latestReactions,
      reactionWitness: reactionWitness,
      reactionState: reactionState,
    };
  }

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
    const usersPostsCountersRoot = usersPostsCountersMap.getRoot();
    const postsRoot = postsMap.getRoot();
    expect(allPostsCounterState).toEqual(Field(0));
    expect(usersPostsCountersState).toEqual(usersPostsCountersRoot);
    expect(postsState).toEqual(postsRoot);

    console.log('PostsContract deployed');

    await deployReactionsContract();

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
      postsMap.getRoot(),
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
    const proof2 = await Reactions.proveReactionPublishingTransition(
      transition2,
      valid2.signature,
      postsMap.getRoot(),
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

    // Send valid proof to update our on-chain state
    const txn2 = await Mina.transaction(user1Address, () => {
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
  });
});
