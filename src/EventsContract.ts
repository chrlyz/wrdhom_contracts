import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleMap,
} from 'snarkyjs';
import { PostsProof } from './Posts';

const newMerkleMap = new MerkleMap();
export const newMerkleMapRoot = newMerkleMap.getRoot();

export class EventsContract extends SmartContract {
  @state(Field) postsGenesis = State<Field>();
  @state(Field) posts = State<Field>();

  init() {
    super.init();
    this.postsGenesis.set(newMerkleMapRoot);
    this.posts.set(newMerkleMapRoot);
  }

  @method update(proof: PostsProof) {
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
}
