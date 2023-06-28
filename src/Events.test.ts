import { LocalBlockchain } from 'snarkyjs/dist/node/lib/mina';
import {
  Events,
  usersTree,
  usersRoot,
  postsTree,
  postsRoot,
  RollupTransition,
  PostState,
  Rollup,
} from './Events';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  Signature,
  Scalar,
} from 'snarkyjs';

let proofsEnabled = false;

describe('Events', () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: Events;

  beforeAll(async () => {
    if (proofsEnabled) await Events.compile();
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
    zkApp = new Events(zkAppAddress);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
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

    const initialPostsNumber = zkApp.postsNumber.get();

    const hashedPost = Field(777);
    const signature = Signature.create(senderKey, [hashedPost]);

    const postWitness = postsTree.getWitness(hashedPost);

    const post1State = new PostState({
      postNumber: Field(1),
      blockHeight: Field(1),
    });

    postsTree.set(hashedPost, post1State.hash());

    const latestPostsRoot = postsTree.getRoot();
    const senderAccountAsField = Poseidon.hash(senderAccount.toFields());

    const userWitness = usersTree.getWitness(senderAccountAsField);

    usersTree.set(senderAccountAsField, latestPostsRoot);

    const latestUsersRoot = usersTree.getRoot();

    const transition1 = RollupTransition.createPostsTransition(
      signature,
      usersRoot,
      latestUsersRoot,
      senderAccount,
      userWitness,
      postsRoot,
      latestPostsRoot,
      hashedPost,
      postWitness,
      initialPostsNumber,
      post1State
    );

    await Rollup.compile();

    const proof1 = await Rollup.postsTransition(
      transition1,
      signature,
      usersRoot,
      latestUsersRoot,
      senderAccount,
      userWitness,
      postsRoot,
      latestPostsRoot,
      hashedPost,
      postWitness,
      initialPostsNumber,
      post1State
    );

    const txn = await Mina.transaction(senderAccount, () => {
      zkApp.update(proof1);
    });

    await txn.prove();
    await txn.sign([senderKey]).send();

    currentUsersRoot = zkApp.users.get();
    currentPostsNumber = zkApp.postsNumber.get();
    expect(currentUsersRoot).toEqual(latestUsersRoot);
    expect(currentPostsNumber).toEqual(Field(1));
  });
});
