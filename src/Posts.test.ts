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

describe('Events', () => {
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
    blockHeight: Field,
    userPostsTree?: MerkleMap
  ) {
    const signature = Signature.create(userKey, [hashedPost]);

    if (userPostsTree == undefined) userPostsTree = new MerkleMap();
    const userPostsRoot = userPostsTree.getRoot();
    const postWitness = userPostsTree.getWitness(hashedPost);

    const postState = new PostState({
      postNumber: postNumber,
      blockHeight: blockHeight,
    });

    userPostsTree.set(hashedPost, postState.hash());

    const latestPostsRoot = userPostsTree.getRoot();
    const userAccountAsField = Poseidon.hash(userAccount.toFields());

    const postsRoot = postsTree.getRoot();
    const userWitness = postsTree.getWitness(userAccountAsField);

    postsTree.set(userAccountAsField, latestPostsRoot);

    const latestUsersRoot = postsTree.getRoot();

    return {
      signature: signature,

      initialUsersRoot: postsRoot,
      latestUsersRoot: latestUsersRoot,
      userAddress: userAccount,
      userWitness: userWitness,

      initialPostsRoot: userPostsRoot,
      latestPostsRoot: latestPostsRoot,
      hashedPost: hashedPost,
      postWitness: postWitness,

      postState: postState,
      userPostsTree: userPostsTree,
    };
  }

  it(`generates and deploys the 'Events' smart contract`, async () => {
    await localDeploy();
    const currentUsersRoot = zkApp.posts.get();
    const currentPostsNumber = zkApp.postsNumber.get();

    const postsTree = new MerkleMap();
    const postsRoot = postsTree.getRoot();

    expect(currentUsersRoot).toEqual(postsRoot);
    expect(currentPostsNumber).toEqual(Field(0));
  });

  it(`updates the state of the 'Events' smart contract`, async () => {
    await localDeploy();

    let currentUsersRoot = zkApp.posts.get();
    let currentPostsNumber = zkApp.postsNumber.get();
    const postsTree = new MerkleMap();
    const postsRoot = postsTree.getRoot();
    expect(currentUsersRoot).toEqual(postsRoot);
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
      valid.initialUsersRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.hashedPost,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    const proof = await PostsRollup.provePostsTransition(
      transition,
      valid.signature,
      valid.initialUsersRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.hashedPost,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    const txn = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof);
    });

    await txn.prove();
    await txn.sign([senderKey]).send();

    currentUsersRoot = zkApp.posts.get();
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentUsersRoot).toEqual(valid.latestUsersRoot);
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
      valid.initialUsersRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.initialPostsRoot,
      valid.latestPostsRoot,
      valid.hashedPost,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    await expect(async () => {
      const proof = await PostsRollup.provePostsTransition(
        transition,
        valid.signature,
        Field(111),
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if 'userAddress' and the key derived from 'userWitness' mismatch,\
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
        valid.initialUsersRoot,
        valid.latestUsersRoot,
        PrivateKey.random().toPublicKey(),
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
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
        valid.initialUsersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        Field(111),
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Bool.assertTrue()`);
  });

  test(`if 'initialUsersRoot' and the root derived from 'userWitness' mismatch,\
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
        Field(111),
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'latestUsersRoot' and the updated root mismatch,\
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
        valid.initialUsersRoot,
        Field(111),
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
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
        valid.initialUsersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        Field(111),
        valid.latestPostsRoot,
        valid.hashedPost,
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
        valid.initialUsersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        Field(111),
        valid.hashedPost,
        valid.postWitness,
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'hashedPost' and the key derived from 'postWitness' mismatch,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1)
    );
    const userPostsTree = new MerkleMap();

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.initialUsersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        userPostsTree.getWitness(Field(111)),
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if the post already exists, 'createPostsTransition()' throws\
  a 'Field.assertEquals()' error`, async () => {
    await localDeploy();

    const userPostsTree = new MerkleMap();
    const postState = new PostState({
      postNumber: Field(1),
      blockHeight: Field(1),
    });
    userPostsTree.set(Field(777), postState.hash());
    postsTree.set(
      Poseidon.hash(senderAccount.toFields()),
      userPostsTree.getRoot()
    );
    const initialUsersRoot = postsTree.getRoot();

    const valid = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(777),
      Field(1),
      Field(1),
      userPostsTree
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        initialUsersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
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
        valid.initialUsersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        valid.postWitness,
        valid.postState.postNumber.add(1),
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
        valid.initialUsersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.initialPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
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

    let currentUsersRoot = zkApp.posts.get();
    let currentPostsNumber = zkApp.postsNumber.get();
    const postsTree = new MerkleMap();
    const postsRoot = postsTree.getRoot();
    expect(currentUsersRoot).toEqual(postsRoot);
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      senderAccount,
      senderKey,
      Field(212),
      Field(2),
      Field(1),
      valid1.userPostsTree
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      senderAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      senderAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
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

    currentUsersRoot = zkApp.posts.get();
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentUsersRoot).toEqual(valid2.latestUsersRoot);
    expect(currentPostsNumber).toEqual(Field(2));
  });

  test(`if it merges 'PostsTransition' proofs from 2 different users`, async () => {
    await localDeploy();

    let currentUsersRoot = zkApp.posts.get();
    let currentPostsNumber = zkApp.postsNumber.get();
    const postsTree = new MerkleMap();
    const postsRoot = postsTree.getRoot();
    expect(currentUsersRoot).toEqual(postsRoot);
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
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

    currentUsersRoot = zkApp.posts.get();
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentUsersRoot).toEqual(valid2.latestUsersRoot);
    expect(currentPostsNumber).toEqual(Field(2));
  });

  test(`if 'latestUsersRoot' of 'postsTransition1Proof' and 'initialUsersRoot'\
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const divergentUsersTree = new MerkleMap();
    const divergentInitialUsersRoot = divergentUsersTree.getRoot();
    const userAccountAsField = Poseidon.hash(deployerAccount.toFields());
    const divergentUserWitness =
      divergentUsersTree.getWitness(userAccountAsField);
    const hashedPost = Field(212);
    const signature = Signature.create(deployerKey, [hashedPost]);
    const userPostsTree = new MerkleMap();
    const initialPostsRoot = userPostsTree.getRoot();
    const postWitness = userPostsTree.getWitness(hashedPost);
    const postState = new PostState({
      postNumber: Field(2),
      blockHeight: Field(1),
    });
    userPostsTree.set(hashedPost, postState.hash());
    const latestPostsRoot = userPostsTree.getRoot();
    divergentUsersTree.set(userAccountAsField, latestPostsRoot);
    const divergentLatestUsersRoot = divergentUsersTree.getRoot();

    const divergentTransition2 = PostsTransition.createPostsTransition(
      signature,
      divergentInitialUsersRoot,
      divergentLatestUsersRoot,
      deployerAccount,
      divergentUserWitness,
      initialPostsRoot,
      latestPostsRoot,
      hashedPost,
      postWitness,
      postState.postNumber.sub(1),
      postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      divergentTransition2,
      signature,
      divergentInitialUsersRoot,
      divergentLatestUsersRoot,
      deployerAccount,
      divergentUserWitness,
      initialPostsRoot,
      latestPostsRoot,
      hashedPost,
      postWitness,
      postState.postNumber.sub(1),
      postState
    );

    const mergedTransitions = new PostsTransition({
      initialUsersRoot: valid1.initialUsersRoot,
      latestUsersRoot: divergentLatestUsersRoot,
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

  test(`if 'initialUsersRoot' of 'postsTransition1Proof' and 'initialUsersRoot'\
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialUsersRoot: Field(111),
      latestUsersRoot: valid2.latestUsersRoot,
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

  test(`if 'latestUsersRoot' of 'postsTransition2Proof'  and 'latestUsersRoot'\
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialUsersRoot: valid1.initialUsersRoot,
      latestUsersRoot: Field(111),
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = PostsTransition.mergePostsTransitions(
      transition1,
      transition2
    );

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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialUsersRoot: valid1.initialUsersRoot,
      latestUsersRoot: valid2.latestUsersRoot,
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialUsersRoot: valid1.initialUsersRoot,
      latestUsersRoot: valid2.latestUsersRoot,
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialUsersRoot: valid1.initialUsersRoot,
      latestUsersRoot: valid2.latestUsersRoot,
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
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.initialUsersRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.initialPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
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
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.initialUsersRoot,
      valid2.latestUsersRoot,
      deployerAccount,
      valid2.userWitness,
      valid2.initialPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );

    const mergedTransitions = new PostsTransition({
      initialUsersRoot: valid1.initialUsersRoot,
      latestUsersRoot: valid2.latestUsersRoot,
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
