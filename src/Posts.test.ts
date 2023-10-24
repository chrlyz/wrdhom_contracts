import { PostsContract } from './PostsContract';
import {
  PostsTransition,
  PostState,
  Posts,
  fieldToFlagPostsAsDeleted,
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

  test(`PostsContract and Posts zkProgram functionality`, async () => {
    // ==============================================================================
    // 1. Deploys PostsContract
    // ==============================================================================

    await localDeploy();
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

    const txn1 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof1);
    });

    await txn1.prove();
    await txn1.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(1));

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
    // 3. Publishes on-chain proof for deletion of 1st post
    // ==============================================================================

    const valid2 = createPostDeletionTransitionValidInputs(
      deployerKey,
      Field(1),
      valid1.postState,
      Field(1)
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

    const txn2 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(proof2);
    });

    await txn2.prove();
    await txn2.sign([deployerKey]).send();
    Local.setBlockchainLength(UInt32.from(2));

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
    // 4. Publishes on-chain proof for publication of 2nd and 3rd posts
    // ==============================================================================

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
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(3),
      Field(1),
      Field(2)
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

    const txn3 = await Mina.transaction(deployerAccount, () => {
      zkApp.update(mergedTransitionProofs1);
    });

    await txn3.prove();
    await txn3.sign([deployerKey, senderKey]).send();
    Local.setBlockchainLength(UInt32.from(3));

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
    // 5. Publishes on-chain proof for deletion of 3rd post
    //    and publication of 4th post
    // ==============================================================================

    const valid5 = createPostDeletionTransitionValidInputs(
      senderKey,
      Field(3),
      valid4.postState,
      Field(3)
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
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'b4444444444444444444444444444444444444444444444444444444444'
      ),
      Field(4),
      Field(2),
      Field(3)
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

    const txn4 = await Mina.transaction(senderAccount, () => {
      zkApp.update(mergedTransitionProofs2);
    });

    await txn4.prove();
    await txn4.sign([senderKey]).send();
    Local.setBlockchainLength(UInt32.from(4));

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
});
