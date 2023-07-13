import { EventsContract } from './EventsContract';
import { PostsTransition, PostState, PostsRollup } from './Posts';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  Signature,
  MerkleMap,
} from 'snarkyjs';

let proofsEnabled = true;

describe(`the 'EventsContract' and the 'PostsRollup' zkProgram`, () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: EventsContract,
    postsTree: MerkleMap;

  beforeAll(async () => {
    await PostsRollup.compile();
    if (proofsEnabled) await EventsContract.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } =
      Local.testAccounts[0]);
    ({ privateKey: senderKey, publicKey: senderAccount } =
      Local.testAccounts[1]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new EventsContract(zkAppAddress);
    postsTree = new MerkleMap();
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
    userAccount: PublicKey,
    userKey: PrivateKey,
    hashedPost: Field,
    postNumber: Field,
    blockHeight: Field
  ) {
    const signature = Signature.create(userKey, [hashedPost]);
    const postsRoot = postsTree.getRoot();
    const postKey = Poseidon.hash(userAccount.toFields().concat(hashedPost));
    const postWitness = postsTree.getWitness(postKey);

    const postState = new PostState({
      postNumber: postNumber,
      blockHeight: blockHeight,
    });

    postsTree.set(postKey, postState.hash());
    const latestPostsRoot = postsTree.getRoot();

    return {
      signature: signature,
      userAddress: userAccount,
      hashedPost: hashedPost,

      initialPostsRoot: postsRoot,
      latestPostsRoot: latestPostsRoot,
      postWitness: postWitness,

      postState: postState,
    };
  }

  it(`generates and deploys the 'EventsContract'`, async () => {
    await localDeploy();
    const currentPostsRoot = zkApp.posts.get();
    const currentPostsNumber = zkApp.postsNumber.get();
    const postsRoot = postsTree.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentPostsNumber).toEqual(Field(0));
  });

  it(`updates the state of the 'EventsContract'`, async () => {
    await localDeploy();

    let currentPostsRoot = zkApp.posts.get();
    let currentPostsNumber = zkApp.postsNumber.get();
    const postsRoot = postsTree.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentPostsNumber).toEqual(Field(0));

    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    const transition = PostsTransition.createPostsTransition(
      valid.signature,
      senderAccount,
      valid.hashedPost,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    const proof = await PostsRollup.provePostsTransition(
      transition,
      valid.signature,
      senderAccount,
      valid.hashedPost,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    const txn = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof);
    });

    await txn.prove();
    await txn.sign([senderKey]).send();

    currentPostsRoot = zkApp.posts.get();
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentPostsRoot).toEqual(valid.latestPostsRoot);
    expect(currentPostsNumber).toEqual(Field(1));
  });

  test(`if 'transition' and 'computedTransition' mismatch,\
  'PostsRollup.provePostsTransition()' throws 'Constraint unsatisfied' error `, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    const transition = PostsTransition.createPostsTransition(
      valid.signature,
      senderAccount,
      valid.hashedPost,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    await expect(async () => {
      const proof = await PostsRollup.provePostsTransition(
        transition,
        valid.signature,
        senderAccount,
        valid.hashedPost,
        Field(111),
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'postState.blockHeight' and 'currentSlot' at the moment of\
  transaction inclusion mismatch, 'EventsContract.update()' throws\
  'Valid_while_precondition_unsatisfied' error`, async () => {
    await localDeploy();

    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(2)
    );

    const transition = PostsTransition.createPostsTransition(
      valid.signature,
      senderAccount,
      valid.hashedPost,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    const proof = await PostsRollup.provePostsTransition(
      transition,
      valid.signature,
      senderAccount,
      valid.hashedPost,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    const txn = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof);
    });

    await txn.prove();

    await expect(async () => {
      await txn.sign([senderKey]).send();
    }).rejects.toThrowError(`Valid_while_precondition_unsatisfied`);
  });

  test(`if 'hashedPost' is signed by a different account,\
  the signature for 'hashedPost' is invalid in 'createPostsTransition()'`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        PrivateKey.random().toPublicKey(),
        valid.hashedPost,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Bool.assertTrue()`);
  });

  test(`if 'signature' is invalid for 'hashedPost',\
  'createPostsTransition()' throws a 'Bool.assertTrue()' error`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        senderAccount,
        Field(111),
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Bool.assertTrue()`);
  });

  test(`if 'initialPostsRoot' and the root derived from 'postWitness' mismatch,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        senderAccount,
        valid.hashedPost,
        Field(111),
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'latestPostsRoot' and the updated root mismatch,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        senderAccount,
        valid.hashedPost,
        valid.initialPostsRoot,
        Field(111),
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if the post already exists, 'createPostsTransition()' throws\
  a 'Field.assertEquals()' error`, async () => {
    await localDeploy();

    const hashedPost = Field(777);
    const postState = new PostState({
      postNumber: Field(1),
      blockHeight: Field(1),
    });
    postsTree.set(
      Poseidon.hash(senderAccount.toFields().concat(hashedPost)),
      postState.hash()
    );
    const initialPostsRoot = postsTree.getRoot();

    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      hashedPost,
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        senderAccount,
        valid.hashedPost,
        initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'initialPostsNumber' is not equal to 'postState.postNumber' minus one,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        senderAccount,
        valid.hashedPost,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postNumber,
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'postState' doesn't generate a root equal to 'latestPostsRoot',\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        senderAccount,
        valid.hashedPost,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        new PostState({
          postNumber: Field(2),
          blockHeight: Field(2),
        })
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  it(`merges 'PostsTransition' proofs`, async () => {
    await localDeploy();

    let currentPostsRoot = zkApp.posts.get();
    let currentPostsNumber = zkApp.postsNumber.get();
    const postsRoot = postsTree.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentPostsNumber).toEqual(Field(0));

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(212),
      Field(2),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      senderAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      senderAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = PostsTransition.mergePostsTransitions(
      transition1,
      transition2
    );

    const mergedTransitionsProof =
      await PostsRollup.proveMergedPostsTransitions(
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
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentPostsRoot).toEqual(valid2.latestPostsRoot);
    expect(currentPostsNumber).toEqual(Field(2));
  });

  test(`if it merges 'PostsTransition' proofs from 2 different users`, async () => {
    await localDeploy();

    let currentPostsRoot = zkApp.posts.get();
    let currentPostsNumber = zkApp.postsNumber.get();
    const postsRoot = postsTree.getRoot();
    expect(currentPostsRoot).toEqual(postsRoot);
    expect(currentPostsNumber).toEqual(Field(0));

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(2),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = PostsTransition.mergePostsTransitions(
      transition1,
      transition2
    );

    const mergedTransitionsProof =
      await PostsRollup.proveMergedPostsTransitions(
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
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentPostsRoot).toEqual(valid2.latestPostsRoot);
    expect(currentPostsNumber).toEqual(Field(2));
  });

  test(`if 'latestPostsRoot' of 'postsTransition1Proof' and 'initialPostsRoot'\
  of 'postsTransition2Proof' mismatch, 'proveMergedPostsTransitions()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const divergentPostsTree = new MerkleMap();
    const divergentInitialPostsRoot = divergentPostsTree.getRoot();
    const hashedPost = Field(212);
    const postKey = Poseidon.hash(
      deployerAccount.toFields().concat(hashedPost)
    );
    const divergentPostWitness = divergentPostsTree.getWitness(postKey);
    const signature = Signature.create(deployerKey, [hashedPost]);
    const postState = new PostState({
      postNumber: Field(2),
      blockHeight: Field(1),
    });
    divergentPostsTree.set(postKey, postState.hash());
    const divergentLatestPostsRoot = divergentPostsTree.getRoot();

    const divergentTransition2 = PostsTransition.createPostsTransition(
      signature,
      deployerAccount,
      hashedPost,
      divergentInitialPostsRoot,
      divergentLatestPostsRoot,
      divergentPostWitness,
      postState.postNumber.sub(1),
      postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      divergentTransition2,
      signature,
      deployerAccount,
      hashedPost,
      divergentInitialPostsRoot,
      divergentLatestPostsRoot,
      divergentPostWitness,
      postState.postNumber.sub(1),
      postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: valid1.initialPostsRoot,
      latestPostsRoot: divergentLatestPostsRoot,
      initialPostsNumber: valid1.postState.postNumber.sub(1),
      latestPostsNumber: postState.postNumber,
      blockHeight: postState.blockHeight,
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'initialPostsRoot' of 'postsTransition1Proof' and 'initialPostsRoot'\
  of 'mergedPostsTransitions' mismatch, 'proveMergedPostsTransitions()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(2),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: Field(111),
      latestPostsRoot: valid2.latestPostsRoot,
      initialPostsNumber: valid1.postState.postNumber.sub(1),
      latestPostsNumber: valid2.postState.postNumber,
      blockHeight: valid2.postState.blockHeight,
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'latestPostsRoot' of 'postsTransition2Proof'  and 'latestPostsRoot'\
  of 'mergedPostsTransitions' mismatch, 'provePostsTransition()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(2),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: valid1.initialPostsRoot,
      latestPostsRoot: Field(111),
      initialPostsNumber: valid1.postState.postNumber.sub(1),
      latestPostsNumber: valid2.postState.postNumber,
      blockHeight: valid2.postState.blockHeight,
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'latestPostsNumber' of 'postsTransition1Proof' and 'initialPostsNumber'\
  of 'postsTransition2Proof' mismatch, 'provePostsTransition()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(1),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: valid1.initialPostsRoot,
      latestPostsRoot: valid2.latestPostsRoot,
      initialPostsNumber: valid1.postState.postNumber.sub(1),
      latestPostsNumber: valid2.postState.postNumber,
      blockHeight: valid2.postState.blockHeight,
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'initialPostsNumber' of 'postsTransition1Proof' and 'initialPostsNumber'\
  of 'mergedPostsTransitions' mismatch, 'provePostsTransition()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(2),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: valid1.initialPostsRoot,
      latestPostsRoot: valid2.latestPostsRoot,
      initialPostsNumber: Field(6),
      latestPostsNumber: valid2.postState.postNumber,
      blockHeight: valid2.postState.blockHeight,
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'latestPostsNumber' of 'postsTransition2Proof' and 'latestPostsNumber'\
  of 'mergedPostsTransitions' mismatch, 'provePostsTransition()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(2),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: valid1.initialPostsRoot,
      latestPostsRoot: valid2.latestPostsRoot,
      initialPostsNumber: valid1.postState.postNumber.sub(1),
      latestPostsNumber: Field(6),
      blockHeight: valid2.postState.blockHeight,
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'blockHeight' of 'postsTransition1Proof' and 'blockHeight'\
  of 'mergedPostsTransitions' mismatch, 'provePostsTransition()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(6)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(2),
      Field(5)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: valid1.initialPostsRoot,
      latestPostsRoot: valid2.latestPostsRoot,
      initialPostsNumber: valid1.postState.postNumber.sub(1),
      latestPostsNumber: valid2.postState.postNumber,
      blockHeight: Field(5),
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'blockHeight' of 'postsTransition2Proof' and 'blockHeight'\
  of 'mergedPostsTransitions' mismatch, 'provePostsTransition()' throws\
  'Constraint unsatisfied' error`, async () => {
    await localDeploy();

    const valid1 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(7)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      senderAccount,
      valid1.hashedPost,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      deployerAccount,
      deployerKey,
      Field(212),
      Field(2),
      Field(6)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      deployerAccount,
      valid2.hashedPost,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialPostsRoot: valid1.initialPostsRoot,
      latestPostsRoot: valid2.latestPostsRoot,
      initialPostsNumber: valid1.postState.postNumber.sub(1),
      latestPostsNumber: valid2.postState.postNumber,
      blockHeight: Field(7),
    });

    await expect(async () => {
      await PostsRollup.proveMergedPostsTransitions(
        mergedTransitions,
        proof1,
        proof2
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });
});
