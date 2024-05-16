import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMap,
  PublicKey,
  MerkleTree,
  MerkleWitness,
  Signature,
  Poseidon
} from 'o1js';
import { PostsTransition, PostsBlockProof } from './Posts.js';
import fs from 'fs/promises';
import { PostsContractB } from './PostsContractB.js';

export type Config = {
  deployAliases: Record<
    string,
    {
      url: string;
      keyPath: string;
      fee: string;
      feepayerKeyPath: string;
      feepayerAlias: string;
    }
  >;
};

// ============================================================================

const newMerkleMap = new MerkleMap();
export const newMerkleMapRoot = newMerkleMap.getRoot();

const newMerkleTree = new MerkleTree(255);
const newMerkleTreeRoot = newMerkleTree.getRoot();
class MerkleWitness255 extends MerkleWitness(255) {}

const postsConfigJson: Config = JSON.parse(
  await fs.readFile('config.json', 'utf8')
);
const postsConfig = postsConfigJson.deployAliases['posts'];
const postsContractAddressBase58: { publicKey: string } = JSON.parse(
  await fs.readFile(postsConfig.keyPath, 'utf8')
);
export const postsContractAddress = PublicKey.fromBase58(
  postsContractAddressBase58.publicKey
);

const BLOCKS_IN_A_DAY = 480;

// ============================================================================

export class PostsContract extends SmartContract {
  @state(Field) allPostsCounter = State<Field>();
  @state(Field) usersPostsCounters = State<Field>();
  @state(Field) posts = State<Field>();
  @state(Field) postsBlockchain = State<Field>();
  @state(Field) lastValidState = State<Field>();

  init() {
    super.init();
    this.allPostsCounter.set(Field(0));
    this.usersPostsCounters.set(newMerkleMapRoot);
    this.posts.set(newMerkleMapRoot);
    this.postsBlockchain.set(newMerkleTreeRoot);
    this.lastValidState.set(Field(0));
  }

  @method async updatePostsBlockChain(
    signature: Signature,
    transitionBlockheight: UInt32,
    allPostsCounterUpdate: Field,
    usersPostsCountersUpdate: Field,
    postsUpdate: Field,
    postsBlockchainUpdate: Field
  ) {
    const isSignatureValid = signature.verify(postsContractAddress, [postsBlockchainUpdate]);
    isSignatureValid.assertTrue();

    this.network.blockchainLength.requireBetween(
      transitionBlockheight,
      transitionBlockheight.add(1)
    );

    this.allPostsCounter.set(allPostsCounterUpdate);
    this.usersPostsCounters.set(usersPostsCountersUpdate);
    this.posts.set(postsUpdate);
    this.postsBlockchain.set(postsBlockchainUpdate);
  }

  @method async provePostsTransitionErrorAndRollback(
    postsBlock1Proof: PostsBlockProof,
    postsBlock2Proof: PostsBlockProof,
    postsBlock1Witness: MerkleWitness255,
    postsBlock2Witness: MerkleWitness255,
    allPostsCounter: Field,
    usersPostsCounters: Field,
    posts: Field,
    postsBlockchain: Field
  ) {
    const postsBlock1WitnessRoot = postsBlock1Witness.calculateRoot(postsBlock1Proof.publicInput.postsBlockHash);
    const postsBlock2WitnessRoot = postsBlock2Witness.calculateRoot(postsBlock2Proof.publicInput.postsBlockHash);
    postsBlock1WitnessRoot.assertEquals(postsBlock2WitnessRoot);
    postsBlock1WitnessRoot.assertEquals(this.postsBlockchain.getAndRequireEquals());

    const postsBlock1WitnessIndex = postsBlock1Witness.calculateIndex();
    const postsBlock2WitnessIndex = postsBlock2Witness.calculateIndex();
    postsBlock2WitnessIndex.assertEquals(postsBlock1WitnessIndex.add(1));

    const initialAllPostsCounterIsValid = postsBlock1Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.latestAllPostsCounter.equals(
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.initialAllPostsCounter
    );
    const initialUsersPostsCountersIsValid = postsBlock1Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.latestUsersPostsCounters.equals(
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.initialUsersPostsCounters
    );
    const initialPostsIsValid = postsBlock1Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.latestPosts.equals(
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.initialPosts
    );
    const isInitialStateValid = initialAllPostsCounterIsValid.and(initialUsersPostsCountersIsValid).and(initialPostsIsValid);
    isInitialStateValid.assertTrue();
    
    const transition =
    PostsTransition.createPostPublishingTransition(
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.signature,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.initialAllPostsCounter,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.initialUsersPostsCounters,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.latestUsersPostsCounters,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.initialUserPostsCounter,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.userPostsCounterWitness,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.initialPosts,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.latestPosts,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.postState,
      postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.postWitness
    );
    const latestAllPostsCounterIsEqual = transition.latestAllPostsCounter.equals(postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.latestAllPostsCounter);
    const latestUsersPostsCountersIsEqual = transition.latestUsersPostsCounters.equals(postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.latestUsersPostsCounters);
    const latestPostsIsEqual = transition.latestPosts.equals(postsBlock2Proof.publicInput.postsBlock.zkProgramMethodInputs.transition.latestPosts);
    const isStateValid = latestAllPostsCounterIsEqual.and(latestUsersPostsCountersIsEqual).and(latestPostsIsEqual);
    isStateValid.assertFalse();

    const lastValidState = Poseidon.hash([allPostsCounter, usersPostsCounters, posts, postsBlockchain]);
    const currentLastValidState = this.lastValidState.getAndRequireEquals();
    lastValidState.assertEquals(currentLastValidState);

    this.allPostsCounter.set(allPostsCounter);
    this.usersPostsCounters.set(usersPostsCounters);
    this.posts.set(posts);
    this.postsBlockchain.set(postsBlockchain);
  }

  @method async setLastValidState() {
    this.network.blockchainLength.getAndRequireEquals().divMod(BLOCKS_IN_A_DAY).rest.assertEquals(UInt32.Unsafe.fromField(Field(0)));

    const currentAllPostsCounter = this.allPostsCounter.getAndRequireEquals();
    const currentUsersPostsCounters = this.usersPostsCounters.getAndRequireEquals();
    const currentPosts = this.posts.getAndRequireEquals();
    const currentPostsBlockchain = this.postsBlockchain.getAndRequireEquals();

    const lastValidState = Poseidon.hash([
      currentAllPostsCounter,
      currentUsersPostsCounters,
      currentPosts,
      currentPostsBlockchain
    ]);

    this.lastValidState.set(lastValidState);
  }

  @method async rollbackByPostsContractB() {
    const postsContractB = new PostsContractB(postsContractAddress);
    const currentPostsBlockchainB = postsContractB.postsBlockchain.getAndRequireEquals();

    this.postsBlockchain.set(currentPostsBlockchainB);
  }
}
