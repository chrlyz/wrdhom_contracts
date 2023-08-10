import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMap,
} from 'snarkyjs';
import { PostsGenesisProof, PostsProof } from './Posts';

const newMerkleMap = new MerkleMap();
const newMerkleMapRoot = newMerkleMap.getRoot();

export class EventsContract extends SmartContract {
  @state(Field) postsGenesis = State<Field>();
  @state(Field) posts = State<Field>();

  init() {
    super.init();
    this.postsGenesis.set(newMerkleMapRoot);
    this.posts.set(newMerkleMapRoot);
  }

  @method updatePostsAndGenesis(proof: PostsGenesisProof) {
    proof.verify();

    this.currentSlot.assertBetween(
      UInt32.from(proof.publicInput.blockHeight.sub(Field(1))),
      UInt32.from(proof.publicInput.blockHeight.add(Field(1)))
    );

    const currentPostsGenesisState = this.postsGenesis.getAndAssertEquals();
    proof.publicInput.initialPostsGenesisRoot.assertEquals(
      currentPostsGenesisState
    );

    const currentPostsState = this.posts.getAndAssertEquals();
    proof.publicInput.initialPostsRoot.assertEquals(currentPostsState);

    this.postsGenesis.set(proof.publicInput.latestPostsGenesisRoot);
    this.posts.set(proof.publicInput.latestPostsRoot);
  }

  @method updatePosts(proof: PostsProof) {
    proof.verify();

    this.currentSlot.assertBetween(
      UInt32.from(proof.publicInput.blockHeight.sub(Field(1))),
      UInt32.from(proof.publicInput.blockHeight.add(Field(1)))
    );

    const currentPostsState = this.posts.getAndAssertEquals();
    proof.publicInput.initialPostsRoot.assertEquals(currentPostsState);

    this.posts.set(proof.publicInput.latestPostsRoot);
  }
}
