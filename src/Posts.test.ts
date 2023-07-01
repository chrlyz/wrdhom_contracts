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
    postsTree: MerkleMap,
    userPostsTree: MerkleMap;

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
    userPostsTree = new MerkleMap();
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
    hashedPost: Field,
    postNumber: Field,
    blockHeight: Field
  ) {
    const signature = Signature.create(senderKey, [hashedPost]);

    const userPostsRoot = userPostsTree.getRoot();
    const postWitness = userPostsTree.getWitness(hashedPost);

    const postState = new PostState({
      postNumber: postNumber,
      blockHeight: blockHeight,
    });

    userPostsTree.set(hashedPost, postState.hash());

    const latestPostsRoot = userPostsTree.getRoot();
    const senderAccountAsField = Poseidon.hash(senderAccount.toFields());

    const postsRoot = postsTree.getRoot();
    const userWitness = postsTree.getWitness(senderAccountAsField);

    postsTree.set(senderAccountAsField, latestPostsRoot);

    const latestUsersRoot = postsTree.getRoot();

    return {
      signature: signature,

      postsRoot: postsRoot,
      initialUsersRoot: postsRoot,
      latestUsersRoot: latestUsersRoot,
      userAddress: senderAccount,
      userWitness: userWitness,

      userPostsRoot: userPostsRoot,
      initialPostsRoot: userPostsRoot,
      latestPostsRoot: latestPostsRoot,
      hashedPost: hashedPost,
      postWitness: postWitness,

      postState: postState,
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
      Field(777),
      Field(1),
      Field(1)
    );

    const transition = PostsTransition.createPostsTransition(
      valid.signature,
      valid.postsRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.userPostsRoot,
      valid.latestPostsRoot,
      valid.hashedPost,
      valid.postWitness,
      valid.postState.postNumber.sub(1),
      valid.postState
    );

    const proof = await PostsRollup.provePostsTransition(
      transition,
      valid.signature,
      valid.postsRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );

    const transition = PostsTransition.createPostsTransition(
      valid.signature,
      valid.postsRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.userPostsRoot,
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
        valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        valid.latestUsersRoot,
        PrivateKey.random().toPublicKey(),
        valid.userWitness,
        valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
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
        valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        Field(111),
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );
    const userPostsTree = new MerkleMap();

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        userPostsTree.getWitness(Field(111)),
        valid.postState.postNumber.sub(1),
        valid.postState
      );
    }).toThrowError(`Field.assertEquals()`);
  });

  test(`if 'initialPostsNumber' is not equal to 'postState.postNumber' minus one,\
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    await localDeploy();
    const valid = createPostsTransitionValidInputs(
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );

    expect(() => {
      PostsTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
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
      Field(777),
      Field(1),
      Field(1)
    );
    const transition1 = PostsTransition.createPostsTransition(
      valid1.signature,
      valid1.postsRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.userPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );
    const proof1 = await PostsRollup.provePostsTransition(
      transition1,
      valid1.signature,
      valid1.postsRoot,
      valid1.latestUsersRoot,
      senderAccount,
      valid1.userWitness,
      valid1.userPostsRoot,
      valid1.latestPostsRoot,
      valid1.hashedPost,
      valid1.postWitness,
      valid1.postState.postNumber.sub(1),
      valid1.postState
    );

    const valid2 = createPostsTransitionValidInputs(
      Field(212),
      Field(2),
      Field(1)
    );
    const transition2 = PostsTransition.createPostsTransition(
      valid2.signature,
      valid2.postsRoot,
      valid2.latestUsersRoot,
      senderAccount,
      valid2.userWitness,
      valid2.userPostsRoot,
      valid2.latestPostsRoot,
      valid2.hashedPost,
      valid2.postWitness,
      valid2.postState.postNumber.sub(1),
      valid2.postState
    );
    const proof2 = await PostsRollup.provePostsTransition(
      transition2,
      valid2.signature,
      valid2.postsRoot,
      valid2.latestUsersRoot,
      senderAccount,
      valid2.userWitness,
      valid2.userPostsRoot,
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
});
