import { EventsContract } from './EventsContract';
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
} from 'snarkyjs';

let proofsEnabled = true;

describe(`the 'EventsContract' and the 'Posts' zkProgram`, () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: EventsContract,
    postsMap: MerkleMap,
    Local: ReturnType<typeof Mina.LocalBlockchain>;

  beforeAll(async () => {
    if (proofsEnabled) {
      await Posts.compile();
      await EventsContract.compile();
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
    zkApp = new EventsContract(zkAppAddress);
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

  function createPostsTransitionValidInputs(
    posterAddress: PublicKey,
    posterKey: PrivateKey,
    postContentID: CircuitString,
    postedAtBlockHeight: Field,
    postIndex: Field
  ) {
    const signature = Signature.create(posterKey, [postContentID.hash()]);
    const initialPostsRoot = postsMap.getRoot();
    const postKey = Poseidon.hash(
      posterAddress.toFields().concat(postContentID.hash())
    );
    const postWitness = postsMap.getWitness(postKey);

    const postState = new PostState({
      posterAddress: posterAddress,
      postContentID: postContentID,
      postIndex: postIndex,
      postedAtBlockHeight: postedAtBlockHeight,
      deletedAtBlockHeight: Field(0),
    });

    postsMap.set(postKey, postState.hash());
    const latestPostsRoot = postsMap.getRoot();

    return {
      signature: signature,
      postState: postState,
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      postWitness: postWitness,
    };
  }

  function createPostDeletionTransitionValidInputs(
    posterKey: PrivateKey,
    initialPostState: PostState,
    deletionBlockHeight: Field
  ) {
    const postStateHash = initialPostState.hash();
    const signature = Signature.create(posterKey, [
      postStateHash,
      fieldToFlagPostsAsDeleted,
    ]);
    const initialPostsRoot = postsMap.getRoot();
    const postKey = Poseidon.hash(
      initialPostState.posterAddress
        .toFields()
        .concat(initialPostState.postContentID.hash())
    );
    const postWitness = postsMap.getWitness(postKey);

    const latestPostState = new PostState({
      posterAddress: initialPostState.posterAddress,
      postContentID: initialPostState.postContentID,
      postIndex: initialPostState.postIndex,
      postedAtBlockHeight: initialPostState.postedAtBlockHeight,
      deletedAtBlockHeight: deletionBlockHeight,
    });

    postsMap.set(postKey, latestPostState.hash());
    const latestPostsRoot = postsMap.getRoot();

    return {
      signature: signature,
      initialPostState: initialPostState,

      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      postWitness: postWitness,
    };
  }

  it(`generates and deploys the 'EventsContract'`, async () => {
    await localDeploy();
    const currentPostsRoot = zkApp.posts.get();
    const currentNumberOfPosts = zkApp.numberOfPosts.get();
    const postsRoot = postsMap.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentNumberOfPosts).toEqual(Field(0));
  });

  it(`updates the state of the 'EventsContract', when publishing a post`, async () => {
    await localDeploy();

    let currentPostsRoot = zkApp.posts.get();
    let currentNumberOfPosts = zkApp.numberOfPosts.get();
    const postsRoot = postsMap.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentNumberOfPosts).toEqual(Field(0));

    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    const transition = PostsTransition.createPostsTransition(
      valid.signature,
      valid.postState,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postIndex.sub(1)
    );

    const proof = await Posts.provePostsTransition(
      transition,
      valid.signature,
      valid.postState,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postIndex.sub(1)
    );

    const txn = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof);
    });

    await txn.prove();
    await txn.sign([senderKey]).send();

    currentPostsRoot = zkApp.posts.get();
    currentNumberOfPosts = zkApp.numberOfPosts.get();
    expect(currentPostsRoot).toEqual(valid.latestPostsRoot);
    expect(currentNumberOfPosts).toEqual(Field(1));
  });

  test(`if 'transition' and 'computedTransition' mismatch,\
  'Posts.provePostsTransition()' throws 'Constraint unsatisfied' error`, async () => {
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    valid.postState.postIndex;

    const transition = new PostsTransition({
      initialPostsRoot: Field(111),
      latestPostsRoot: valid.latestPostsRoot,
      initialNumberOfPosts: valid.postState.postIndex.sub(1),
      latestNumberOfPosts: valid.postState.postIndex,
      blockHeight: valid.postState.postedAtBlockHeight,
    });

    await expect(async () => {
      const proof = await Posts.provePostsTransition(
        transition,
        valid.signature,
        valid.postState,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postIndex.sub(1)
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'postState.postedAtBlockHeight' and 'currentSlot' at the moment of\
  transaction inclusion mismatch, 'EventsContract.update()' throws\
  'Valid_while_precondition_unsatisfied' error`, async () => {
    await localDeploy();

    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(2),
      Field(1)
    );

    const transition = PostsTransition.createPostsTransition(
      valid.signature,
      valid.postState,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postIndex.sub(1)
    );

    const proof = await Posts.provePostsTransition(
      transition,
      valid.signature,
      valid.postState,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postIndex.sub(1)
    );

    const txn = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof);
    });

    await txn.prove();

    await expect(async () => {
      await txn.sign([senderKey]).send();
    }).rejects.toThrowError(`Valid_while_precondition_unsatisfied`);
  });

  test(`if the user has already posted the content,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error `, async () => {
    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const proof1 = await Posts.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const valid2 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(2)
    );

    expect(() => {
      const transition2 = PostsTransition.createPostsTransition(
        valid2.signature,
        valid2.postState,
        valid2.initialPostsRoot,
        valid2.latestPostsRoot,
        valid2.postWitness,
        valid2.postState.postIndex.sub(1)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'postContentID' is signed by a different account,\
  the signature for 'postContentID' is invalid in 'createPostsTransition()'`, async () => {
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    const invalidPostState = new PostState({
      posterAddress: deployerAccount,
      postContentID: valid.postState.postContentID,
      postIndex: valid.postState.postIndex,
      postedAtBlockHeight: valid.postState.postedAtBlockHeight,
      deletedAtBlockHeight: valid.postState.deletedAtBlockHeight,
    });

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        invalidPostState,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postIndex.sub(1)
      );
    }).toThrowError(`Bool.assertTrue()`);
  });

  test(`if 'signature' is invalid for 'postContentID',\
  'createPostsTransition()' throws a 'Bool.assertTrue()' error`, async () => {
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    const invalidPostState = new PostState({
      posterAddress: valid.postState.posterAddress,
      postContentID: CircuitString.fromString(
        'bduuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ),
      postIndex: valid.postState.postIndex,
      postedAtBlockHeight: valid.postState.postedAtBlockHeight,
      deletedAtBlockHeight: valid.postState.deletedAtBlockHeight,
    });

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        invalidPostState,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postIndex.sub(1)
      );
    }).toThrowError(`Bool.assertTrue()`);
  });

  test(`if 'initialPostsRoot' and the root derived from 'postWitness' mismatch,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postState,
        Field(849),
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postIndex.sub(1)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'latestPostsRoot' and the updated root mismatch,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postState,
        valid.initialPostsRoot,
        Field(849),
        valid.postWitness,
        valid.postState.postIndex.sub(1)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'initialNumberOfPosts' is not equal to the key derived from 'postWitness' minus one,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postState,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        Field(849)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'postState' doesn't generate a root equal to 'latestPostsRoot',\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    const invalidPostState = new PostState({
      posterAddress: valid.postState.posterAddress,
      postContentID: valid.postState.postContentID,
      postIndex: valid.postState.postIndex,
      postedAtBlockHeight: Field(849),
      deletedAtBlockHeight: valid.postState.deletedAtBlockHeight,
    });

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        invalidPostState,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postIndex.sub(1)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  it(`merges 'PostsTransition' proofs`, async () => {
    await localDeploy();

    let currentPostsRoot = zkApp.posts.get();
    let currentNumberOfPosts = zkApp.numberOfPosts.get();
    const postsRoot = postsMap.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentNumberOfPosts).toEqual(Field(0));

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const proof1 = await Posts.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const valid2 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii'
      ),
      Field(1),
      Field(2)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      valid2.postState,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postIndex.sub(1)
    );

    const proof2 = await Posts.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.postState,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postIndex.sub(1)
    );

    const mergedTransitions = PostsTransition.mergePostsTransitions(
      transition1,
      transition2
    );

    const mergedTransitionsProof = await Posts.proveMergedPostsTransitions(
      mergedTransitions,
      proof1,
      proof2
    );

    const txn = await Mina.transaction(senderAccount, () => {
      zkApp.update(mergedTransitionsProof);
    });

    await txn.prove();
    await txn.sign([senderKey]).send();

    currentPostsRoot = zkApp.posts.get();
    currentNumberOfPosts = zkApp.numberOfPosts.get();
    expect(currentPostsRoot).toEqual(valid2.latestPostsRoot);
    expect(currentNumberOfPosts).toEqual(Field(2));
  });

  it(`updates the state of the 'EventsContract', when deleting a post`, async () => {
    await localDeploy();

    let currentPostsRoot = zkApp.posts.get();
    let currentNumberOfPosts = zkApp.numberOfPosts.get();
    const postsRoot = postsMap.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentNumberOfPosts).toEqual(Field(0));

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const proof1 = await Posts.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const txn1 = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof1);
    });

    await txn1.prove();
    await txn1.sign([senderKey]).send();

    currentPostsRoot = zkApp.posts.get();
    currentNumberOfPosts = zkApp.numberOfPosts.get();
    expect(currentPostsRoot).toEqual(valid1.latestPostsRoot);
    expect(currentNumberOfPosts).toEqual(Field(1));

    Local.setGlobalSlot(2);

    const valid2 = createPostDeletionTransitionValidInputs(
      senderKey,
      valid1.postState,
      Field(2)
    );
    const transition2 = PostsTransition.createPostDeletionTransition(
      valid2.signature,
      valid2.initialPostState,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      Field(1),
      Field(2)
    );
    const proof2 = await Posts.provePostDeletionTransition(
      transition2,
      valid2.signature,
      valid2.initialPostState,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      Field(1),
      Field(2)
    );

    const txn2 = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof2);
    });

    await txn2.prove();
    await txn2.sign([senderKey]).send();

    currentPostsRoot = zkApp.posts.get();
    currentNumberOfPosts = zkApp.numberOfPosts.get();
    expect(currentPostsRoot).toEqual(valid2.latestPostsRoot);
    expect(valid1.latestPostsRoot).not.toEqual(valid2.latestPostsRoot);
    expect(currentNumberOfPosts).toEqual(Field(1));
  });

  test(`if 'transition' and 'computedTransition' mismatch,\
  'Posts.provePostDeletionTransition()' throws 'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const proof1 = await Posts.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const txn1 = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof1);
    });

    await txn1.prove();
    await txn1.sign([senderKey]).send();

    Local.setGlobalSlot(2);
    const valid2 = createPostDeletionTransitionValidInputs(
      senderKey,
      valid1.postState,
      Field(2)
    );

    const numberOfPosts = Field(1);
    const transition2 = new PostsTransition({
      initialPostsRoot: Field(849),
      latestPostsRoot: valid2.latestPostsRoot,
      initialNumberOfPosts: numberOfPosts,
      latestNumberOfPosts: numberOfPosts,
      blockHeight: valid2.initialPostState.deletedAtBlockHeight,
    });

    await expect(async () => {
      const proof2 = await Posts.provePostDeletionTransition(
        transition2,
        valid2.signature,
        valid2.initialPostState,
        valid2.initialPostsRoot,
        valid2.latestPostsRoot,
        valid2.postWitness,
        Field(1),
        Field(2)
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if message to delete post is signed by a different account,\
  the signature is invalid in 'createPostDeletionTransition()'`, async () => {
    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );

    const valid2 = createPostDeletionTransitionValidInputs(
      deployerKey,
      valid1.postState,
      Field(2)
    );

    expect(() => {
      PostsTransition.createPostDeletionTransition(
        valid2.signature,
        valid2.initialPostState,
        valid2.initialPostsRoot,
        valid2.latestPostsRoot,
        valid2.postWitness,
        Field(1),
        Field(1)
      );
    }).toThrowError(`Bool.assertTrue()`);
  });

  test(`if 'signature' is invalid for message to delete post,\
  'createPostDeletionTransition()' throws a 'Bool.assertTrue()' error`, async () => {
    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const invalidPostState = new PostState({
      posterAddress: valid1.postState.posterAddress,
      postContentID: CircuitString.fromString(
        'bduuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ),
      postIndex: valid1.postState.postIndex,
      postedAtBlockHeight: valid1.postState.postedAtBlockHeight,
      deletedAtBlockHeight: valid1.postState.deletedAtBlockHeight,
    });

    const valid2 = createPostDeletionTransitionValidInputs(
      senderKey,
      valid1.postState,
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostDeletionTransition(
        valid2.signature,
        invalidPostState,
        valid2.initialPostsRoot,
        valid2.latestPostsRoot,
        valid2.postWitness,
        Field(1),
        Field(1)
      );
    }).toThrowError(`Bool.assertTrue()`);
  });

  test(`if 'initialPostsRoot' and the root derived from 'postWitness' mismatch,\
  'createPostDeletionTransition()' throws a 'Field.assertEquals()' error`, async () => {
    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const valid2 = createPostDeletionTransitionValidInputs(
      senderKey,
      valid1.postState,
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostDeletionTransition(
        valid2.signature,
        valid2.initialPostState,
        Field(849),
        valid2.latestPostsRoot,
        valid2.postWitness,
        Field(1),
        Field(1)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'latestPostsRoot' and the updated root mismatch,\
  'createPostDeletionTransition()' throws a 'Field.assertEquals()' error`, async () => {
    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const valid2 = createPostDeletionTransitionValidInputs(
      senderKey,
      valid1.postState,
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostDeletionTransition(
        valid2.signature,
        valid2.initialPostState,
        valid2.initialPostsRoot,
        Field(849),
        valid2.postWitness,
        Field(1),
        Field(1)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if the post doesn't exist, 'createPostDeletionTransition()'\
  throws a 'Field.assertEquals()' error`, async () => {
    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const valid2 = createPostDeletionTransitionValidInputs(
      senderKey,
      valid1.postState,
      Field(1)
    );

    const emptyMap = new MerkleMap();
    const emptyMapRoot = emptyMap.getRoot();

    expect(() => {
      PostsTransition.createPostDeletionTransition(
        valid2.signature,
        valid2.initialPostState,
        emptyMapRoot,
        valid2.latestPostsRoot,
        valid2.postWitness,
        Field(1),
        Field(1)
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  it(`merges post deletion transitions`, async () => {
    await localDeploy();

    let currentPostsRoot = zkApp.posts.get();
    let currentNumberOfPosts = zkApp.numberOfPosts.get();
    const postsRoot = postsMap.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentNumberOfPosts).toEqual(Field(0));

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const proof1 = await Posts.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.postState,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postIndex.sub(1)
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      CircuitString.fromString(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      ),
      Field(1),
      Field(2)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      valid2.postState,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postIndex.sub(1)
    );

    const proof2 = await Posts.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.postState,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postIndex.sub(1)
    );

    const mergedTransitions1 = PostsTransition.mergePostsTransitions(
      transition1,
      transition2
    );

    const mergedTransitionsProof1 = await Posts.proveMergedPostsTransitions(
      mergedTransitions1,
      proof1,
      proof2
    );

    const txn1 = await Mina.transaction(senderAccount, () => {
      zkApp.update(mergedTransitionsProof1);
    });

    await txn1.prove();
    await txn1.sign([senderKey]).send();

    currentPostsRoot = zkApp.posts.get();
    currentNumberOfPosts = zkApp.numberOfPosts.get();
    expect(currentPostsRoot).toEqual(valid2.latestPostsRoot);
    expect(currentNumberOfPosts).toEqual(Field(2));

    Local.setGlobalSlot(2);
    const deletedAtBlockHeight = Field(2);
    const numberOfPosts = Field(2);

    const valid3 = createPostDeletionTransitionValidInputs(
      senderKey,
      valid1.postState,
      deletedAtBlockHeight
    );
    const transition3 = PostsTransition.createPostDeletionTransition(
      valid3.signature,
      valid3.initialPostState,
      valid3.initialPostsRoot,
      valid3.latestPostsRoot,
      valid3.postWitness,
      numberOfPosts,
      deletedAtBlockHeight
    );
    const proof3 = await Posts.provePostDeletionTransition(
      transition3,
      valid3.signature,
      valid3.initialPostState,
      valid3.initialPostsRoot,
      valid3.latestPostsRoot,
      valid3.postWitness,
      numberOfPosts,
      deletedAtBlockHeight
    );

    const valid4 = createPostDeletionTransitionValidInputs(
      deployerKey,
      valid2.postState,
      deletedAtBlockHeight
    );
    const transition4 = PostsTransition.createPostDeletionTransition(
      valid4.signature,
      valid4.initialPostState,
      valid4.initialPostsRoot,
      valid4.latestPostsRoot,
      valid4.postWitness,
      numberOfPosts,
      deletedAtBlockHeight
    );
    const proof4 = await Posts.provePostDeletionTransition(
      transition4,
      valid4.signature,
      valid4.initialPostState,
      valid4.initialPostsRoot,
      valid4.latestPostsRoot,
      valid4.postWitness,
      numberOfPosts,
      deletedAtBlockHeight
    );

    const mergedTransitions2 = PostsTransition.mergePostsTransitions(
      transition3,
      transition4
    );

    const mergedTransitionsProof2 = await Posts.proveMergedPostsTransitions(
      mergedTransitions2,
      proof3,
      proof4
    );

    const txn2 = await Mina.transaction(senderAccount, () => {
      zkApp.update(mergedTransitionsProof2);
    });

    await txn2.prove();
    await txn2.sign([senderKey]).send();

    currentPostsRoot = zkApp.posts.get();
    currentNumberOfPosts = zkApp.numberOfPosts.get();
    expect(currentPostsRoot).toEqual(valid4.latestPostsRoot);
    expect(valid1.latestPostsRoot).not.toEqual(valid2.latestPostsRoot);
    expect(valid2.latestPostsRoot).not.toEqual(valid3.latestPostsRoot);
    expect(valid3.latestPostsRoot).not.toEqual(valid4.latestPostsRoot);
    expect(currentNumberOfPosts).toEqual(Field(2));
  });
});
