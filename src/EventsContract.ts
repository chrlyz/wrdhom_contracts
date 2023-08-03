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

const postsTree = new MerkleMap();
const postsRoot = postsTree.getRoot();

export class EventsContract extends SmartContract {
  @state(Field) posts = State<Field>();
  @state(Field) numberOfPosts = State<Field>();

  init() {
    super.init();
    this.posts.set(postsRoot);
    this.numberOfPosts.set(Field(0));
  }

  @method update(rollupProof: PostsProof) {
    rollupProof.verify();

    this.currentSlot.assertBetween(
      UInt32.from(rollupProof.publicInput.blockHeight.sub(Field(1))),
      UInt32.from(rollupProof.publicInput.blockHeight.add(Field(1)))
    );

    const currentState = this.posts.getAndAssertEquals();
    rollupProof.publicInput.initialPostsRoot.assertEquals(currentState);

    const currentPostsNumber = this.numberOfPosts.getAndAssertEquals();
    rollupProof.publicInput.initialNumberOfPosts.assertEquals(
      currentPostsNumber
    );

    this.posts.set(rollupProof.publicInput.latestPostsRoot);
    this.numberOfPosts.set(rollupProof.publicInput.latestNumberOfPosts);
  }
}
