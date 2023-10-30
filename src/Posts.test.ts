import { PostsContract } from './PostsContract';
import {
  PostsTransition,
  PostState,
  Posts,
  fieldToFlagPostsAsDeleted,
  fieldToFlagPostsAsRestored,
} from './Posts';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Signature,
  CircuitString,
  Poseidon,
  MerkleMap,
  UInt32,
} from 'o1js';

let proofsEnabled = true;

describe(`the PostsContract and the Posts zkProgram`, () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: PostsContract,
    usersPostsCountersMap: MerkleMap,
    postsMap: MerkleMap,
    Local: ReturnType<typeof Mina.LocalBlockchain>;

  beforeAll(async () => {
    if (proofsEnabled) {
      console.log('Compiling Posts zkProgram...');
      await Posts.compile();
      console.log('Compiling PostsContract...');
      await PostsContract.compile();
      console.log('Compiled');
    }
  });

  beforeEach(() => {
    Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } =
      Local.testAccounts[0]);
    ({ privateKey: senderKey, publicKey: senderAccount } =
      Local.testAccounts[1]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new PostsContract(zkAppAddress);
    usersPostsCountersMap = new MerkleMap();
    postsMap = new MerkleMap();
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  function createPostPublishingTransitionValidInputs(
    posterAddress: PublicKey,
    posterKey: PrivateKey,
    postContentID: CircuitString,
    allPostsCounter: Field,
    userPostsCounter: Field,
    postBlockHeight: Field
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
      postBlockHeight: postBlockHeight,
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

  function createPostRestorationTransitionValidInputs(
    posterKey: PrivateKey,
    allPostsCounter: Field,
    initialPostState: PostState,
    restorationBlockHeight: Field
  ) {
    const postStateHash = initialPostState.hash();
    const signature = Signature.create(posterKey, [
      postStateHash,
      fieldToFlagPostsAsRestored,
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
      deletionBlockHeight: Field(0),
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
      restorationBlockHeight: restorationBlockHeight,
    };
  }

  // ==============================================================================
  // Tests are structured in batches for 2 reasons:
  //
  // 1. To avoid time consuming redundant operations when preparing the context
  //    for a test.
  //
  // 2. Due to memory limitations of wasm32 and how memory for proofs and
  //    transactions is currently managed by a process, which cause an error
  //    after too many proofs and transactions have been generated within the
  //    same process.
  // ==============================================================================

  test(`PostsContract and Posts zkProgram functionality. 1st batch of tests.`, async () => {
    // ==============================================================================
    // 1. Deploys PostsContract.
    // ==============================================================================

    await localDeploy();

    // Validate expected state
    const allPostsCounterState = zkApp.allPostsCounter.get();
    const usersPostsCountersState = zkApp.usersPostsCounters.get();
    const postsState = zkApp.posts.get();
    const usersPostsCountersRoot = usersPostsCountersMap.getRoot();
    const postsRoot = postsMap.getRoot();
    expect(allPostsCounterState).toEqual(Field(0));
    expect(usersPostsCountersState).toEqual(usersPostsCountersRoot);
    expect(postsState).toEqual(postsRoot);

    // ==============================================================================
    // 2. Publishes on-chain proof for publication of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid1 = createPostPublishingTransitionValidInputs(
      deployerAccount,
      deployerKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1),
      Field(0)
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
    const txn1 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof1);
    });
    await txn1.prove();
    await txn1.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(1));

    // Validate expected state
    const allPostsCounterState1 = zkApp.allPostsCounter.get();
    const usersPostsCountersState1 = zkApp.usersPostsCounters.get();
    const postsState1 = zkApp.posts.get();
    const usersPostsCountersRoot1 = usersPostsCountersMap.getRoot();
    const postsRoot1 = postsMap.getRoot();
    expect(allPostsCounterState1).toEqual(Field(1));
    expect(usersPostsCountersState1).toEqual(usersPostsCountersRoot1);
    expect(usersPostsCountersState1).not.toEqual(usersPostsCountersRoot);
    expect(postsState1).toEqual(postsRoot1);
    expect(postsState1).not.toEqual(postsRoot);

    console.log('First post published');

    // ==============================================================================
    // 3. Publishes on-chain proof for deletion of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid2 = createPostDeletionTransitionValidInputs(
      deployerKey,
      Field(1),
      valid1.postState,
      Field(1)
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Send valid proof to update our on-chain state
    const txn2 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof2);
    });
    await txn2.prove();
    await txn2.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(2));

    // Validate expected state
    const allPostsCounterState2 = zkApp.allPostsCounter.get();
    const usersPostsCountersState2 = zkApp.usersPostsCounters.get();
    const postsState2 = zkApp.posts.get();
    const usersPostsCountersRoot2 = usersPostsCountersMap.getRoot();
    const postsRoot2 = postsMap.getRoot();
    expect(allPostsCounterState2).toEqual(Field(1));
    expect(usersPostsCountersState2).toEqual(usersPostsCountersRoot2);
    expect(postsState2).toEqual(postsRoot2);
    expect(postsState2).not.toEqual(postsRoot1);

    console.log('First post deleted');

    // ==============================================================================
    // 4. Publishes on-chain proof (from merged proofs) for publication of 2nd
    //    and 3rd posts.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid3 = createPostPublishingTransitionValidInputs(
      deployerAccount,
      deployerKey,
      CircuitString.fromString(
        'b3333333333333333333333333333333333333333333333333333333333'
      ),
      Field(2),
      Field(2),
      Field(2)
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Prepare inputs to create a valid state transition
    const valid4 = createPostPublishingTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(3),
      Field(1),
      Field(2)
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Merge valid state transitions
    const mergedTransitions1 = PostsTransition.mergePostsTransitions(
      transition3,
      transition4
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs1 = await Posts.proveMergedPostsTransitions(
      mergedTransitions1,
      proof3,
      proof4
    );

    // Send valid proof to update our on-chain state
    const txn3 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(mergedTransitionProofs1);
    });
    await txn3.prove();
    await txn3.sign([deployerKey, senderKey]).send();
    Local.setBlockchainLength(UInt32.from(3));

    // Validate expected state
    const allPostsCounterState3 = zkApp.allPostsCounter.get();
    const usersPostsCountersState3 = zkApp.usersPostsCounters.get();
    const postsState3 = zkApp.posts.get();
    const usersPostsCountersRoot3 = usersPostsCountersMap.getRoot();
    const postsRoot3 = postsMap.getRoot();
    expect(allPostsCounterState3).toEqual(Field(3));
    expect(usersPostsCountersState3).toEqual(usersPostsCountersRoot3);
    expect(usersPostsCountersState3).not.toEqual(usersPostsCountersRoot2);
    expect(postsState3).toEqual(postsRoot3);
    expect(postsState3).not.toEqual(postsRoot2);

    console.log('Second and third posts published through merged proofs');

    // ==============================================================================
    // 5. Publishes on-chain proof (from merged proofs) for deletion of 3rd post
    //    and publication of 4th post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid5 = createPostDeletionTransitionValidInputs(
      senderKey,
      Field(3),
      valid4.postState,
      Field(3)
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Prepare inputs to create a valid state transition
    const valid6 = createPostPublishingTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'b4444444444444444444444444444444444444444444444444444444444'
      ),
      Field(4),
      Field(2),
      Field(3)
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Merge valid state transitions
    const mergedTransitions2 = PostsTransition.mergePostsTransitions(
      transition5,
      transition6
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs2 = await Posts.proveMergedPostsTransitions(
      mergedTransitions2,
      proof5,
      proof6
    );

    // Send valid proof to update our on-chain state
    const txn4 = await Mina.transaction(senderAccount, () => {
      zkApp.update(mergedTransitionProofs2);
    });
    await txn4.prove();
    await txn4.sign([senderKey]).send();
    Local.setBlockchainLength(UInt32.from(4));

    // Validate expected state
    const allPostsCounterState4 = zkApp.allPostsCounter.get();
    const usersPostsCountersState4 = zkApp.usersPostsCounters.get();
    const postsState4 = zkApp.posts.get();
    const usersPostsCountersRoot4 = usersPostsCountersMap.getRoot();
    const postsRoot4 = postsMap.getRoot();
    expect(allPostsCounterState4).toEqual(Field(4));
    expect(usersPostsCountersState4).toEqual(usersPostsCountersRoot4);
    expect(usersPostsCountersState4).not.toEqual(usersPostsCountersRoot3);
    expect(postsState4).toEqual(postsRoot4);
    expect(postsState4).not.toEqual(postsRoot3);

    console.log(
      'Third post deleted and fourth post published through merged proofs'
    );

    // ==============================================================================
    // 6. Extra validation for all the state updates so far
    // ==============================================================================

    const newUsersPostsCountersMap = new MerkleMap();
    const deployerAccountAsField = Poseidon.hash(deployerAccount.toFields());
    const senderAccountAsField = Poseidon.hash(senderAccount.toFields());
    newUsersPostsCountersMap.set(deployerAccountAsField, Field(2));
    newUsersPostsCountersMap.set(senderAccountAsField, Field(2));
    expect(newUsersPostsCountersMap.getRoot()).toEqual(usersPostsCountersRoot4);

    const post1 = new PostState({
      posterAddress: valid1.postState.posterAddress,
      postContentID: valid1.postState.postContentID,
      allPostsCounter: valid1.postState.allPostsCounter,
      userPostsCounter: valid1.postState.userPostsCounter,
      postBlockHeight: valid1.postState.postBlockHeight,
      deletionBlockHeight: Field(1),
    });
    const post2 = new PostState({
      posterAddress: valid3.postState.posterAddress,
      postContentID: valid3.postState.postContentID,
      allPostsCounter: valid3.postState.allPostsCounter,
      userPostsCounter: valid3.postState.userPostsCounter,
      postBlockHeight: valid3.postState.postBlockHeight,
      deletionBlockHeight: valid3.postState.deletionBlockHeight,
    });
    const post3 = new PostState({
      posterAddress: valid4.postState.posterAddress,
      postContentID: valid4.postState.postContentID,
      allPostsCounter: valid4.postState.allPostsCounter,
      userPostsCounter: valid4.postState.userPostsCounter,
      postBlockHeight: valid4.postState.postBlockHeight,
      deletionBlockHeight: Field(3),
    });
    const post4 = new PostState({
      posterAddress: valid6.postState.posterAddress,
      postContentID: valid6.postState.postContentID,
      allPostsCounter: valid6.postState.allPostsCounter,
      userPostsCounter: valid6.postState.userPostsCounter,
      postBlockHeight: valid6.postState.postBlockHeight,
      deletionBlockHeight: valid6.postState.deletionBlockHeight,
    });

    const newPostsMap = new MerkleMap();
    newPostsMap.set(
      Poseidon.hash([deployerAccountAsField, post1.postContentID.hash()]),
      post1.hash()
    );
    newPostsMap.set(
      Poseidon.hash([deployerAccountAsField, post2.postContentID.hash()]),
      post2.hash()
    );
    newPostsMap.set(
      Poseidon.hash([senderAccountAsField, post3.postContentID.hash()]),
      post3.hash()
    );
    newPostsMap.set(
      Poseidon.hash([senderAccountAsField, post4.postContentID.hash()]),
      post4.hash()
    );
    expect(newPostsMap.getRoot()).toEqual(postsState4);

    console.log('Successful extra validation of all the state updates');
  });

  test(`PostsContract and Posts zkProgram functionality. 2nd batch of tests.`, async () => {
    // ==============================================================================
    // 1. Deploys PostsContract
    // ==============================================================================

    await localDeploy();

    // Validate expected state
    const allPostsCounterState = zkApp.allPostsCounter.get();
    const usersPostsCountersState = zkApp.usersPostsCounters.get();
    const postsState = zkApp.posts.get();
    const usersPostsCountersRoot = usersPostsCountersMap.getRoot();
    const postsRoot = postsMap.getRoot();
    expect(allPostsCounterState).toEqual(Field(0));
    expect(usersPostsCountersState).toEqual(usersPostsCountersRoot);
    expect(postsState).toEqual(postsRoot);

    // ==============================================================================
    // 2. Publishes on-chain proof for publication of 1st post
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid1 = createPostPublishingTransitionValidInputs(
      deployerAccount,
      deployerKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1),
      Field(0)
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
    const txn1 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof1);
    });
    await txn1.prove();
    await txn1.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(1));

    // Validate expected state
    const allPostsCounterState1 = zkApp.allPostsCounter.get();
    const usersPostsCountersState1 = zkApp.usersPostsCounters.get();
    const postsState1 = zkApp.posts.get();
    const usersPostsCountersRoot1 = usersPostsCountersMap.getRoot();
    const postsRoot1 = postsMap.getRoot();
    expect(allPostsCounterState1).toEqual(Field(1));
    expect(usersPostsCountersState1).toEqual(usersPostsCountersRoot1);
    expect(usersPostsCountersState1).not.toEqual(usersPostsCountersState);
    expect(postsState1).toEqual(postsRoot1);
    expect(postsState1).not.toEqual(postsState);

    console.log('First post published');

    // ==============================================================================
    // 3. Publishes on-chain proof for deletion of 1st post
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid2 = createPostDeletionTransitionValidInputs(
      deployerKey,
      Field(1),
      valid1.postState,
      Field(1)
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Send valid proof to update our on-chain state
    const txn2 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof2);
    });
    await txn2.prove();
    await txn2.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(2));

    // Validate expected state
    const allPostsCounterState2 = zkApp.allPostsCounter.get();
    const usersPostsCountersState2 = zkApp.usersPostsCounters.get();
    const postsState2 = zkApp.posts.get();
    const usersPostsCountersRoot2 = usersPostsCountersMap.getRoot();
    const postsRoot2 = postsMap.getRoot();
    expect(allPostsCounterState2).toEqual(allPostsCounterState1);
    expect(usersPostsCountersState2).toEqual(usersPostsCountersState1);
    expect(usersPostsCountersState2).toEqual(usersPostsCountersRoot2);
    expect(postsState2).toEqual(postsRoot2);
    expect(postsState2).not.toEqual(postsState1);

    console.log('First post deleted');

    // ==============================================================================
    // 4. Publishes on-chain proof for restoration of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid3 = createPostRestorationTransitionValidInputs(
      deployerKey,
      Field(1),
      valid2.latestPostState,
      Field(2)
    );

    // Create a valid state transition
    const transition3 = PostsTransition.createPostRestorationTransition(
      valid3.signature,
      valid3.allPostsCounter,
      valid3.usersPostsCounters,
      valid3.initialPosts,
      valid3.latestPosts,
      valid3.initialPostState,
      valid3.postWitness,
      valid3.restorationBlockHeight
    );

    // Create valid proof for our state transition
    const proof3 = await Posts.provePostRestorationTransition(
      transition3,
      valid3.signature,
      valid3.allPostsCounter,
      valid3.usersPostsCounters,
      valid3.initialPosts,
      valid3.latestPosts,
      valid3.initialPostState,
      valid3.postWitness,
      valid3.restorationBlockHeight
    );

    // Send valid proof to update our on-chain state
    const txn3 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof3);
    });
    await txn3.prove();
    await txn3.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(3));

    // Validate expected state
    const allPostsCounterState3 = zkApp.allPostsCounter.get();
    const usersPostsCountersState3 = zkApp.usersPostsCounters.get();
    const postsState3 = zkApp.posts.get();
    const usersPostsCountersRoot3 = usersPostsCountersMap.getRoot();
    const postsRoot3 = postsMap.getRoot();
    expect(allPostsCounterState3).toEqual(allPostsCounterState2);
    expect(usersPostsCountersState3).toEqual(usersPostsCountersState2);
    expect(usersPostsCountersState3).toEqual(usersPostsCountersRoot3);
    expect(postsState3).toEqual(postsRoot3);
    expect(postsState3).not.toEqual(postsRoot2);

    console.log('First post restored');

    // ==============================================================================
    // 5. Publishes on-chain proof (from merged proofs) for publication of 2nd
    //    and 3rd posts.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid4 = createPostPublishingTransitionValidInputs(
      deployerAccount,
      deployerKey,
      CircuitString.fromString(
        'b3333333333333333333333333333333333333333333333333333333333'
      ),
      Field(2),
      Field(2),
      Field(3)
    );

    // Create a valid state transition
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

    // Create valid proof for our state transition
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

    // Prepare inputs to create a valid state transition
    const valid5 = createPostPublishingTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(3),
      Field(1),
      Field(3)
    );

    // Create a valid state transition
    const transition5 = PostsTransition.createPostPublishingTransition(
      valid5.signature,
      valid5.postState.allPostsCounter.sub(1),
      valid5.initialUsersPostsCounters,
      valid5.latestUsersPostsCounters,
      valid5.postState.userPostsCounter.sub(1),
      valid5.userPostsCounterWitness,
      valid5.initialPosts,
      valid5.latestPosts,
      valid5.postState,
      valid5.postWitness
    );

    // Create valid proof for our state transition
    const proof5 = await Posts.provePostPublishingTransition(
      transition5,
      valid5.signature,
      valid5.postState.allPostsCounter.sub(1),
      valid5.initialUsersPostsCounters,
      valid5.latestUsersPostsCounters,
      valid5.postState.userPostsCounter.sub(1),
      valid5.userPostsCounterWitness,
      valid5.initialPosts,
      valid5.latestPosts,
      valid5.postState,
      valid5.postWitness
    );

    // Merge valid state transitions
    const mergedTransitions1 = PostsTransition.mergePostsTransitions(
      transition4,
      transition5
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs1 = await Posts.proveMergedPostsTransitions(
      mergedTransitions1,
      proof4,
      proof5
    );

    // Send valid proof to update our on-chain state
    const txn4 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(mergedTransitionProofs1);
    });
    await txn4.prove();
    await txn4.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(4));

    // Validate expected state
    const allPostsCounterState4 = zkApp.allPostsCounter.get();
    const usersPostsCountersState4 = zkApp.usersPostsCounters.get();
    const postsState4 = zkApp.posts.get();
    const usersPostsCountersRoot4 = usersPostsCountersMap.getRoot();
    const postsRoot4 = postsMap.getRoot();
    expect(allPostsCounterState4).toEqual(Field(3));
    expect(usersPostsCountersState4).toEqual(usersPostsCountersRoot4);
    expect(usersPostsCountersState4).not.toEqual(usersPostsCountersRoot3);
    expect(postsState4).toEqual(postsRoot4);
    expect(postsState4).not.toEqual(postsRoot3);

    console.log('Second and third posts published through merged proofs');

    // ==============================================================================
    // 5. Publishes on-chain proof (from merged proofs) for deletion of 2nd
    //    and 3rd posts.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid6 = createPostDeletionTransitionValidInputs(
      deployerKey,
      Field(3),
      valid4.postState,
      Field(4)
    );

    // Create a valid state transition
    const transition6 = PostsTransition.createPostDeletionTransition(
      valid6.signature,
      valid6.allPostsCounter,
      valid6.usersPostsCounters,
      valid6.initialPosts,
      valid6.latestPosts,
      valid6.initialPostState,
      valid6.postWitness,
      valid6.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    const proof6 = await Posts.provePostDeletionTransition(
      transition6,
      valid6.signature,
      valid6.allPostsCounter,
      valid6.usersPostsCounters,
      valid6.initialPosts,
      valid6.latestPosts,
      valid6.initialPostState,
      valid6.postWitness,
      valid6.latestPostState.deletionBlockHeight
    );

    // Prepare inputs to create a valid state transition
    const valid7 = createPostDeletionTransitionValidInputs(
      senderKey,
      Field(3),
      valid5.postState,
      Field(4)
    );

    // Create a valid state transition
    const transition7 = PostsTransition.createPostDeletionTransition(
      valid7.signature,
      valid7.allPostsCounter,
      valid7.usersPostsCounters,
      valid7.initialPosts,
      valid7.latestPosts,
      valid7.initialPostState,
      valid7.postWitness,
      valid7.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    const proof7 = await Posts.provePostDeletionTransition(
      transition7,
      valid7.signature,
      valid7.allPostsCounter,
      valid7.usersPostsCounters,
      valid7.initialPosts,
      valid7.latestPosts,
      valid7.initialPostState,
      valid7.postWitness,
      valid7.latestPostState.deletionBlockHeight
    );

    // Merge valid state transitions
    const mergedTransitions2 = PostsTransition.mergePostsTransitions(
      transition6,
      transition7
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs2 = await Posts.proveMergedPostsTransitions(
      mergedTransitions2,
      proof6,
      proof7
    );

    // Send valid proof to update our on-chain state
    const txn5 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(mergedTransitionProofs2);
    });
    await txn5.prove();
    await txn5.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(5));

    // Validate expected state
    const allPostsCounterState5 = zkApp.allPostsCounter.get();
    const usersPostsCountersState5 = zkApp.usersPostsCounters.get();
    const postsState5 = zkApp.posts.get();
    const usersPostsCountersRoot5 = usersPostsCountersMap.getRoot();
    const postsRoot5 = postsMap.getRoot();
    expect(allPostsCounterState5).toEqual(allPostsCounterState4);
    expect(usersPostsCountersState5).toEqual(usersPostsCountersState4);
    expect(usersPostsCountersState5).toEqual(usersPostsCountersRoot5);
    expect(postsState5).toEqual(postsRoot5);
    expect(postsState5).not.toEqual(postsState4);

    console.log('Second and third posts deleted through merged proofs');

    // ==============================================================================
    // 6. Publishes on-chain proof (from merged proofs) for restoration of 2nd
    //    and 3rd posts.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid8 = createPostRestorationTransitionValidInputs(
      deployerKey,
      Field(3),
      valid6.latestPostState,
      Field(5)
    );

    // Create a valid state transition
    const transition8 = PostsTransition.createPostRestorationTransition(
      valid8.signature,
      valid8.allPostsCounter,
      valid8.usersPostsCounters,
      valid8.initialPosts,
      valid8.latestPosts,
      valid8.initialPostState,
      valid8.postWitness,
      valid8.restorationBlockHeight
    );

    // Create valid proof for our state transition
    const proof8 = await Posts.provePostRestorationTransition(
      transition8,
      valid8.signature,
      valid8.allPostsCounter,
      valid8.usersPostsCounters,
      valid8.initialPosts,
      valid8.latestPosts,
      valid8.initialPostState,
      valid8.postWitness,
      valid8.restorationBlockHeight
    );

    // Prepare inputs to create a valid state transition
    const valid9 = createPostRestorationTransitionValidInputs(
      senderKey,
      Field(3),
      valid7.latestPostState,
      Field(5)
    );

    // Create a valid state transition
    const transition9 = PostsTransition.createPostRestorationTransition(
      valid9.signature,
      valid9.allPostsCounter,
      valid9.usersPostsCounters,
      valid9.initialPosts,
      valid9.latestPosts,
      valid9.initialPostState,
      valid9.postWitness,
      valid9.restorationBlockHeight
    );

    // Create valid proof for our state transition
    const proof9 = await Posts.provePostRestorationTransition(
      transition9,
      valid9.signature,
      valid9.allPostsCounter,
      valid9.usersPostsCounters,
      valid9.initialPosts,
      valid9.latestPosts,
      valid9.initialPostState,
      valid9.postWitness,
      valid9.restorationBlockHeight
    );

    // Merge valid state transitions
    const mergedTransitions3 = PostsTransition.mergePostsTransitions(
      transition8,
      transition9
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs3 = await Posts.proveMergedPostsTransitions(
      mergedTransitions3,
      proof8,
      proof9
    );

    // Send valid proof to update our on-chain state
    const txn6 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(mergedTransitionProofs3);
    });
    await txn6.prove();
    await txn6.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(6));

    // Validate expected state
    const allPostsCounterState6 = zkApp.allPostsCounter.get();
    const usersPostsCountersState6 = zkApp.usersPostsCounters.get();
    const postsState6 = zkApp.posts.get();
    const usersPostsCountersRoot6 = usersPostsCountersMap.getRoot();
    const postsRoot6 = postsMap.getRoot();
    expect(allPostsCounterState6).toEqual(allPostsCounterState5);
    expect(usersPostsCountersState6).toEqual(usersPostsCountersState5);
    expect(usersPostsCountersState6).toEqual(usersPostsCountersRoot6);
    expect(postsState6).toEqual(postsRoot6);
    expect(postsState6).not.toEqual(postsState5);

    console.log('Second and third posts restored through merged proofs');

    // ==============================================================================
    // 7. Publishes on-chain proof for deletion of 2nd post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid10 = createPostDeletionTransitionValidInputs(
      deployerKey,
      Field(3),
      valid8.latestPostState,
      Field(6)
    );

    // Create a valid state transition
    const transition10 = PostsTransition.createPostDeletionTransition(
      valid10.signature,
      valid10.allPostsCounter,
      valid10.usersPostsCounters,
      valid10.initialPosts,
      valid10.latestPosts,
      valid10.initialPostState,
      valid10.postWitness,
      valid10.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    const proof10 = await Posts.provePostDeletionTransition(
      transition10,
      valid10.signature,
      valid10.allPostsCounter,
      valid10.usersPostsCounters,
      valid10.initialPosts,
      valid10.latestPosts,
      valid10.initialPostState,
      valid10.postWitness,
      valid10.latestPostState.deletionBlockHeight
    );

    // Send valid proof to update our on-chain state
    const txn7 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof10);
    });
    await txn7.prove();
    await txn7.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(7));

    // Validate expected state
    const allPostsCounterState7 = zkApp.allPostsCounter.get();
    const usersPostsCountersState7 = zkApp.usersPostsCounters.get();
    const postsState7 = zkApp.posts.get();
    const usersPostsCountersRoot7 = usersPostsCountersMap.getRoot();
    const postsRoot7 = postsMap.getRoot();
    expect(allPostsCounterState7).toEqual(allPostsCounterState6);
    expect(usersPostsCountersState7).toEqual(usersPostsCountersState6);
    expect(usersPostsCountersState7).toEqual(usersPostsCountersRoot7);
    expect(postsState7).toEqual(postsRoot7);
    expect(postsState7).not.toEqual(postsState6);

    console.log('Second post deleted');

    // ==============================================================================
    // 8. Publishes on-chain proof (from merged proofs) for restoration of 2nd post,
    //    and deletion of 3rd post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid11 = createPostRestorationTransitionValidInputs(
      deployerKey,
      Field(3),
      valid10.latestPostState,
      Field(7)
    );

    // Create a valid state transition
    const transition11 = PostsTransition.createPostRestorationTransition(
      valid11.signature,
      valid11.allPostsCounter,
      valid11.usersPostsCounters,
      valid11.initialPosts,
      valid11.latestPosts,
      valid11.initialPostState,
      valid11.postWitness,
      valid11.restorationBlockHeight
    );

    // Create valid proof for our state transition
    const proof11 = await Posts.provePostRestorationTransition(
      transition11,
      valid11.signature,
      valid11.allPostsCounter,
      valid11.usersPostsCounters,
      valid11.initialPosts,
      valid11.latestPosts,
      valid11.initialPostState,
      valid11.postWitness,
      valid11.restorationBlockHeight
    );

    // Prepare inputs to create a valid state transition
    const valid12 = createPostDeletionTransitionValidInputs(
      senderKey,
      Field(3),
      valid9.latestPostState,
      Field(7)
    );

    // Create a valid state transition
    const transition12 = PostsTransition.createPostDeletionTransition(
      valid12.signature,
      valid12.allPostsCounter,
      valid12.usersPostsCounters,
      valid12.initialPosts,
      valid12.latestPosts,
      valid12.initialPostState,
      valid12.postWitness,
      valid12.latestPostState.deletionBlockHeight
    );

    // Create valid proof for our state transition
    const proof12 = await Posts.provePostDeletionTransition(
      transition12,
      valid12.signature,
      valid12.allPostsCounter,
      valid12.usersPostsCounters,
      valid12.initialPosts,
      valid12.latestPosts,
      valid12.initialPostState,
      valid12.postWitness,
      valid12.latestPostState.deletionBlockHeight
    );

    // Merge valid state transitions
    const mergedTransitions4 = PostsTransition.mergePostsTransitions(
      transition11,
      transition12
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs4 = await Posts.proveMergedPostsTransitions(
      mergedTransitions4,
      proof11,
      proof12
    );

    // Send valid proof to update our on-chain state
    const txn8 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(mergedTransitionProofs4);
    });
    await txn8.prove();
    await txn8.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(8));

    // Validate expected state
    const allPostsCounterState8 = zkApp.allPostsCounter.get();
    const usersPostsCountersState8 = zkApp.usersPostsCounters.get();
    const postsState8 = zkApp.posts.get();
    const usersPostsCountersRoot8 = usersPostsCountersMap.getRoot();
    const postsRoot8 = postsMap.getRoot();
    expect(allPostsCounterState8).toEqual(allPostsCounterState7);
    expect(usersPostsCountersState8).toEqual(usersPostsCountersState7);
    expect(usersPostsCountersState8).toEqual(usersPostsCountersRoot8);
    expect(postsState8).toEqual(postsRoot8);
    expect(postsState8).not.toEqual(postsState7);

    console.log('Second and third posts restored and deleted, respectively');

    // ==============================================================================
    // 9. Publishes on-chain proof (from merged proofs) for restoration of 3rd post,
    //    and publication of 4th post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid13 = createPostRestorationTransitionValidInputs(
      senderKey,
      Field(3),
      valid12.latestPostState,
      Field(8)
    );

    // Create a valid state transition
    const transition13 = PostsTransition.createPostRestorationTransition(
      valid13.signature,
      valid13.allPostsCounter,
      valid13.usersPostsCounters,
      valid13.initialPosts,
      valid13.latestPosts,
      valid13.initialPostState,
      valid13.postWitness,
      valid13.restorationBlockHeight
    );

    // Create valid proof for our state transition
    const proof13 = await Posts.provePostRestorationTransition(
      transition13,
      valid13.signature,
      valid13.allPostsCounter,
      valid13.usersPostsCounters,
      valid13.initialPosts,
      valid13.latestPosts,
      valid13.initialPostState,
      valid13.postWitness,
      valid13.restorationBlockHeight
    );

    // Prepare inputs to create a valid state transition
    const valid14 = createPostPublishingTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'b4444444444444444444444444444444444444444444444444444444444'
      ),
      Field(4),
      Field(2),
      Field(8)
    );

    // Create a valid state transition
    const transition14 = PostsTransition.createPostPublishingTransition(
      valid14.signature,
      valid14.postState.allPostsCounter.sub(1),
      valid14.initialUsersPostsCounters,
      valid14.latestUsersPostsCounters,
      valid14.postState.userPostsCounter.sub(1),
      valid14.userPostsCounterWitness,
      valid14.initialPosts,
      valid14.latestPosts,
      valid14.postState,
      valid14.postWitness
    );

    // Create valid proof for our state transition
    const proof14 = await Posts.provePostPublishingTransition(
      transition14,
      valid14.signature,
      valid14.postState.allPostsCounter.sub(1),
      valid14.initialUsersPostsCounters,
      valid14.latestUsersPostsCounters,
      valid14.postState.userPostsCounter.sub(1),
      valid14.userPostsCounterWitness,
      valid14.initialPosts,
      valid14.latestPosts,
      valid14.postState,
      valid14.postWitness
    );

    // Merge valid state transitions
    const mergedTransitions5 = PostsTransition.mergePostsTransitions(
      transition13,
      transition14
    );

    // Create proof of valid merged state transitions
    const mergedTransitionProofs5 = await Posts.proveMergedPostsTransitions(
      mergedTransitions5,
      proof13,
      proof14
    );

    // Send valid proof to update our on-chain state
    const txn9 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(mergedTransitionProofs5);
    });
    await txn9.prove();
    await txn9.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(9));

    // Validate expected state
    const allPostsCounterState9 = zkApp.allPostsCounter.get();
    const usersPostsCountersState9 = zkApp.usersPostsCounters.get();
    const postsState9 = zkApp.posts.get();
    const usersPostsCountersRoot9 = usersPostsCountersMap.getRoot();
    const postsRoot9 = postsMap.getRoot();
    expect(allPostsCounterState9).toEqual(Field(4));
    expect(usersPostsCountersState9).not.toEqual(usersPostsCountersState8);
    expect(usersPostsCountersState9).toEqual(usersPostsCountersRoot9);
    expect(postsState9).toEqual(postsRoot9);
    expect(postsState9).not.toEqual(postsState8);

    console.log('3rd and 4th posts restored and publicated, respectively');
  });
});
