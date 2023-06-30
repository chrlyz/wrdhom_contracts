import { EventsContract } from './EventsContract';
import { RollupTransition, PostState, PostsRollup } from './Posts';
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
    zkApp: EventsContract;

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
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  function createPostsTransitionValidInputs() {
    const initialPostsNumber = zkApp.postsNumber.get();

    const hashedPost = Field(777);
    const signature = Signature.create(senderKey, [hashedPost]);

    const userPostsTree = new MerkleMap();
    const userPostsRoot = userPostsTree.getRoot();

    const postWitness = userPostsTree.getWitness(hashedPost);

    const postState = new PostState({
      postNumber: Field(1),
      blockHeight: Field(1),
    });

    userPostsTree.set(hashedPost, postState.hash());

    const latestPostsRoot = userPostsTree.getRoot();
    const senderAccountAsField = Poseidon.hash(senderAccount.toFields());

    const postsTree = new MerkleMap();
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

      initialPostsNumber: initialPostsNumber,
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

    const valid = createPostsTransitionValidInputs();

    const transition = RollupTransition.createPostsTransition(
      valid.signature,
      valid.postsRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.userPostsRoot,
      valid.latestPostsRoot,
      valid.hashedPost,
      valid.postWitness,
      valid.initialPostsNumber,
      valid.postState
    );

    const proof = await PostsRollup.postsTransition(
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
      valid.initialPostsNumber,
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

  test(`if 'transition' and 'computedTransition' mismatch \
  'PostsRollup.postsTransition()' throws 'Constraint unsatisfied' error `, async () => {
    await localDeploy();

    const valid = createPostsTransitionValidInputs();

    const transition = RollupTransition.createPostsTransition(
      valid.signature,
      valid.postsRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      valid.userPostsRoot,
      valid.latestPostsRoot,
      valid.hashedPost,
      valid.postWitness,
      valid.initialPostsNumber,
      valid.postState
    );

    await expect(async () => {
      const proof = await PostsRollup.postsTransition(
        transition,
        valid.signature,
        Field(222),
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        valid.postWitness,
        valid.initialPostsNumber,
        valid.postState
      );
    }).rejects.toThrowError(`Constraint unsatisfied (unreduced)`);
  });

  test(`if there's a message and signature mismatch \
  'createPostsTransition()' throws a 'Bool.assertTrue()' error`, async () => {
    await localDeploy();

    const valid = createPostsTransitionValidInputs();
    const signatureMismatchedHashedPost = Field(666);

    expect(() => {
      RollupTransition.createPostsTransition(
        valid.signature,
        valid.postsRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
        valid.latestPostsRoot,
        signatureMismatchedHashedPost,
        valid.postWitness,
        valid.initialPostsNumber,
        valid.postState
      );
    }).toThrowError(`Bool.assertTrue(): false != true`);
  });

  test(`if 'initialUsersRoot' and the root derived from 'userWitness' mismatch \
  'createPostsTransition()' throws a 'Field.assertEquals()' error`, async () => {
    await localDeploy();

    const valid = createPostsTransitionValidInputs();

    expect(() => {
      RollupTransition.createPostsTransition(
        valid.signature,
        Field(999),
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        valid.userPostsRoot,
        valid.latestPostsRoot,
        valid.hashedPost,
        valid.postWitness,
        valid.initialPostsNumber,
        valid.postState
      );
    }).toThrowError(`Field.assertEquals(): 999 !=`);
  });
});
