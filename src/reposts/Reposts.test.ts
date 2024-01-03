import { PostsContract } from '../posts/PostsContract';
import { PostsTransition, PostState, Posts } from '../posts/Posts';
import { RepostsContract } from './RepostsContract';
import { RepostsTransition, RepostState, Reposts } from './Reposts';
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
} from 'o1js';
import { Config } from '../posts/PostsDeploy';
import fs from 'fs/promises';
import {
  deployPostsContract,
  createPostPublishingTransitionValidInputs,
} from '../posts/PostsUtils';

let proofsEnabled = true;

describe(`the RepostsContract and the Reposts ZkProgram`, () => {
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
    repostsContractAddress: PublicKey,
    repostsContractKey: PrivateKey,
    repostsContract: RepostsContract,
    usersRepostsCountersMap: MerkleMap,
    repostsMap: MerkleMap;

  beforeAll(async () => {
    if (proofsEnabled) {
      console.log('Compiling Posts ZkProgram...');
      await Posts.compile();
      console.log('Compiling PostsContract...');
      await PostsContract.compile();
      console.log('Compiling Reposts ZkProgram...');
      await Reposts.compile();
      console.log('Compiling RepostsContract...');
      await RepostsContract.compile();
      console.log('Compiled');
    }
  });

  beforeEach(async () => {
    Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: user1Key, publicKey: user1Address } = Local.testAccounts[0]);
    ({ privateKey: user2Key, publicKey: user2Address } = Local.testAccounts[1]);

    const postsConfigJson: Config = JSON.parse(
      await fs.readFile('config.json', 'utf8')
    );
    const postsConfig = postsConfigJson.deployAliases['posts'];
    const postsContractKeyBase58: { privateKey: string } = JSON.parse(
      await fs.readFile(postsConfig.keyPath, 'utf8')
    );
    postsContractKey = PrivateKey.fromBase58(postsContractKeyBase58.privateKey);
    postsContractAddress = postsContractKey.toPublicKey();
    postsContract = new PostsContract(postsContractAddress);
    usersPostsCountersMap = new MerkleMap();
    postsMap = new MerkleMap();

    const repostsConfigJson: Config = JSON.parse(
      await fs.readFile('config.json', 'utf8')
    );
    const repostsConfig = repostsConfigJson.deployAliases['reposts'];
    const repostsContractKeyBase58: { privateKey: string } = JSON.parse(
      await fs.readFile(repostsConfig.keyPath, 'utf8')
    );
    repostsContractKey = PrivateKey.fromBase58(
      repostsContractKeyBase58.privateKey
    );
    repostsContractAddress = repostsContractKey.toPublicKey();
    repostsContract = new RepostsContract(repostsContractAddress);
    usersRepostsCountersMap = new MerkleMap();
    repostsMap = new MerkleMap();
  });

  async function deployRepostsContract() {
    const txn = await Mina.transaction(user1Address, () => {
      AccountUpdate.fundNewAccount(user1Address);
      repostsContract.deploy();
    });
    await txn.prove();
    await txn.sign([user1Key, repostsContractKey]).send();
  }

  function createRepostTransitionValidInputs(
    postState: PostState,
    reposterAddress: PublicKey,
    reposterKey: PrivateKey,
    allRepostsCounter: Field,
    userRepostsCounter: Field,
    repostBlockHeight: Field
  ) {
    const posterAddressAsField = Poseidon.hash(
      postState.posterAddress.toFields()
    );
    const postContentIDHash = postState.postContentID.hash();
    const signature = Signature.create(reposterKey, [
      posterAddressAsField,
      postContentIDHash,
      userRepostsCounter,
    ]);

    const initialUsersRepostsCounters = usersRepostsCountersMap.getRoot();
    const reposterAddressAsField = Poseidon.hash(reposterAddress.toFields());
    usersRepostsCountersMap.set(reposterAddressAsField, userRepostsCounter);
    const latestUsersRepostsCounters = usersRepostsCountersMap.getRoot();
    const userRepostsCounterWitness = usersRepostsCountersMap.getWitness(
      reposterAddressAsField
    );

    const postWitness = postsMap.getWitness(
      Poseidon.hash([posterAddressAsField, postContentIDHash])
    );

    const repostState = new RepostState({
      posterAddress: postState.posterAddress,
      postContentID: postState.postContentID,
      reposterAddress: reposterAddress,
      allRepostsCounter: allRepostsCounter,
      userRepostsCounter: userRepostsCounter,
      repostBlockHeight: repostBlockHeight,
      deletionBlockHeight: Field(0),
    });

    const initialReposts = repostsMap.getRoot();
    const repostKey = Poseidon.hash([
      reposterAddressAsField,
      posterAddressAsField,
      postContentIDHash,
      userRepostsCounter,
    ]);
    repostsMap.set(repostKey, repostState.hash());
    const latestReposts = repostsMap.getRoot();
    const repostWitness = repostsMap.getWitness(repostKey);

    return {
      signature: signature,
      initialUsersRepostsCounters: initialUsersRepostsCounters,
      latestUsersRepostsCounters: latestUsersRepostsCounters,
      userRepostsCounterWitness: userRepostsCounterWitness,
      postState: postState,
      postWitness: postWitness,
      initialReposts: initialReposts,
      latestReposts: latestReposts,
      repostState: repostState,
      repostWitness: repostWitness,
    };
  }

  test(`RepostsContract and Reposts zkProgram functionality`, async () => {
    // ==============================================================================
    // 1. Deploys PostsContract and RepostsContract.
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

    await deployRepostsContract();

    // Validate expected state
    const allRepostsCounterState = repostsContract.allRepostsCounter.get();
    const userRepostsCountersState = repostsContract.usersRepostsCounters.get();
    const repostsState = repostsContract.reposts.get();
    const usersRepostsCountersRoot = usersRepostsCountersMap.getRoot();
    const repostsRoot = repostsMap.getRoot();
    expect(allRepostsCounterState).toEqual(Field(0));
    expect(userRepostsCountersState).toEqual(usersRepostsCountersRoot);
    expect(repostsState).toEqual(repostsRoot);

    console.log('RepostsContract deployed');

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
    // 3. Publishes on-chain proof for reposting of 1st post.
    // ==============================================================================

    // Prepare inputs to create a valid state transition
    const valid2 = createRepostTransitionValidInputs(
      valid1.postState,
      user2Address,
      user2Key,
      Field(1),
      Field(1),
      Field(1)
    );

    // Create a valid state transition
    const transition2 = RepostsTransition.createRepostTransition(
      valid2.signature,
      valid2.repostState.allRepostsCounter.sub(1),
      valid2.repostState.userRepostsCounter.sub(1),
      valid2.initialUsersRepostsCounters,
      valid2.latestUsersRepostsCounters,
      valid2.userRepostsCounterWitness,
      postsContract.posts.get(),
      valid2.postState,
      valid2.postWitness,
      valid2.initialReposts,
      valid2.latestReposts,
      valid2.repostState,
      valid2.repostWitness
    );

    // Create valid proof for our state transition
    const proof2 = await Reposts.proveRepostTransition(
      transition2,
      valid2.signature,
      valid2.repostState.allRepostsCounter.sub(1),
      valid2.repostState.userRepostsCounter.sub(1),
      valid2.initialUsersRepostsCounters,
      valid2.latestUsersRepostsCounters,
      valid2.userRepostsCounterWitness,
      postsContract.posts.get(),
      valid2.postState,
      valid2.postWitness,
      valid2.initialReposts,
      valid2.latestReposts,
      valid2.repostState,
      valid2.repostWitness
    );

    // Send valid proof to update our on-chain state
    const txn2 = await Mina.transaction(user1Address, () => {
      repostsContract.update(proof2);
    });
    await txn2.prove();
    await txn2.sign([user1Key]).send();
    Local.setBlockchainLength(UInt32.from(2));

    const allRepostsCounterState1 = repostsContract.allRepostsCounter.get();
    const userRepostsCountersState1 =
      repostsContract.usersRepostsCounters.get();
    const repostsState1 = repostsContract.reposts.get();
    const usersRepostsCountersRoot1 = usersRepostsCountersMap.getRoot();
    const repostsRoot1 = repostsMap.getRoot();
    expect(allRepostsCounterState1).toEqual(Field(1));
    expect(allRepostsCounterState1).not.toEqual(allRepostsCounterState);
    expect(userRepostsCountersState1).toEqual(usersRepostsCountersRoot1);
    expect(userRepostsCountersState1).not.toEqual(userRepostsCountersState);
    expect(repostsState1).toEqual(repostsRoot1);
    expect(repostsState1).not.toEqual(repostsState);

    console.log('1st post reposted');
  });
});
