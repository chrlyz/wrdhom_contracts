import { EventsContract, usersTree, usersRoot } from './EventsContract';
import {
  postsTree,
  postsRoot,
  RollupTransition,
  PostState,
  PostsRollup,
} from './Posts';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  Signature,
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

    const postWitness = postsTree.getWitness(hashedPost);

    const postState = new PostState({
      postNumber: Field(1),
      blockHeight: Field(1),
    });

    postsTree.set(hashedPost, postState.hash());

    const latestPostsRoot = postsTree.getRoot();
    const senderAccountAsField = Poseidon.hash(senderAccount.toFields());

    const userWitness = usersTree.getWitness(senderAccountAsField);

    usersTree.set(senderAccountAsField, latestPostsRoot);

    const latestUsersRoot = usersTree.getRoot();

    return {
      signature: signature,

      initialUsersRoot: usersRoot,
      latestUsersRoot: latestUsersRoot,
      userAddress: senderAccount,
      userWitness: userWitness,

      initialPostsRoot: postsRoot,
      latestPostsRoot: latestPostsRoot,
      hashedPost: hashedPost,
      postWitness: postWitness,

      initialPostsNumber: initialPostsNumber,
      postState: postState,
    };
  }

  it('generates and deploys the `Events` smart contract', async () => {
    await localDeploy();
    const currentUsersRoot = zkApp.users.get();
    const currentPostsNumber = zkApp.postsNumber.get();
    expect(currentUsersRoot).toEqual(usersRoot);
    expect(currentPostsNumber).toEqual(Field(0));
  });

  it('updates the state of the `Events` smart contract', async () => {
    await localDeploy();
    let currentUsersRoot = zkApp.users.get();
    let currentPostsNumber = zkApp.postsNumber.get();
    expect(currentUsersRoot).toEqual(usersRoot);
    expect(currentPostsNumber).toEqual(Field(0));

    const valid = createPostsTransitionValidInputs();

    const transition = RollupTransition.createPostsTransition(
      valid.signature,
      usersRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      postsRoot,
      valid.latestPostsRoot,
      valid.hashedPost,
      valid.postWitness,
      valid.initialPostsNumber,
      valid.postState
    );

    const proof = await PostsRollup.postsTransition(
      transition,
      valid.signature,
      usersRoot,
      valid.latestUsersRoot,
      senderAccount,
      valid.userWitness,
      postsRoot,
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

    currentUsersRoot = zkApp.users.get();
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentUsersRoot).toEqual(valid.latestUsersRoot);
    expect(currentPostsNumber).toEqual(Field(1));
  });

  it(`'createPostsTransition' fails if the signature for the message is
  invalid`, async () => {
    await localDeploy();

    const valid = createPostsTransitionValidInputs();
    const signatureMismatchedHashedPost = Field(666);

    expect(() => {
      RollupTransition.createPostsTransition(
        valid.signature,
        usersRoot,
        valid.latestUsersRoot,
        senderAccount,
        valid.userWitness,
        postsRoot,
        valid.latestPostsRoot,
        signatureMismatchedHashedPost,
        valid.postWitness,
        valid.initialPostsNumber,
        valid.postState
      );
    }).toThrowError(`Bool.assertTrue(): false != true`);
  });
});
