import {
  Field,
  SmartContract,
  state,
  State,
  method,
  UInt32,
  MerkleTree,
  MerkleWitness,
} from 'snarkyjs';
import { PostsProof } from './Posts';

const postsTree = new MerkleTree(10);
const postsRoot = postsTree.getRoot();

export class EventsContract extends SmartContract {
  @state(Field) posts = State<Field>();
  @state(Field) postsNumber = State<Field>();

  init() {
    super.init();
    this.posts.set(postsRoot);
    this.postsNumber.set(Field(0));
  }

  @method update(rollupProof: PostsProof) {
    rollupProof.verify();

    this.currentSlot.assertBetween(
      UInt32.from(rollupProof.publicInput.blockHeight.sub(Field(1))),
      UInt32.from(rollupProof.publicInput.blockHeight.add(Field(1)))
    );

    const currentState = this.posts.getAndAssertEquals();
    rollupProof.publicInput.initialPostsRoot.assertEquals(currentState);

    const currentPostsNumber = this.postsNumber.getAndAssertEquals();
    rollupProof.publicInput.initialPostsNumber.assertEquals(currentPostsNumber);

    this.posts.set(rollupProof.publicInput.latestPostsRoot);
    this.postsNumber.set(rollupProof.publicInput.latestPostsNumber);
  }
}
