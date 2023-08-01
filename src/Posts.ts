import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  Experimental,
  SelfProof,
  CircuitString,
  MerkleTree,
  MerkleWitness,
} from 'snarkyjs';

// ============================================================================

export const fieldToFlagPostsAsDeleted = Field(93137);
const postsTree = new MerkleTree(10);
const postsRoot = postsTree.getRoot();
export class PostsWitness extends MerkleWitness(10) {}

// ============================================================================

export class PostState extends Struct({
  posterAddress: PublicKey,
  postContentID: CircuitString,
  postIndex: Field,
  postedAtBlockHeight: Field,
  deletedAtBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash(
      this.posterAddress
        .toFields()
        .concat([
          this.postContentID.hash(),
          this.postIndex,
          this.postedAtBlockHeight,
          this.deletedAtBlockHeight,
        ])
    );
  }
}

// ============================================================================

export class PostsTransition extends Struct({
  initialPostsRoot: Field,
  latestPostsRoot: Field,
  initialNumberOfPosts: Field,
  latestNumberOfPosts: Field,
  blockHeight: Field,
}) {
  static createPostsTransition(
    signature: Signature,
    postState: PostState,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    postWitness: PostsWitness,

    initialNumberOfPosts: Field
  ) {
    const isSigned = signature.verify(postState.posterAddress, [
      postState.postContentID.hash(),
      postState.postIndex,
    ]);
    isSigned.assertTrue();

    const postsRootBefore = postWitness.calculateRoot(Field(0));
    initialPostsRoot.assertEquals(postsRootBefore);

    const postIndex = postWitness.calculateIndex();
    postState.postIndex.assertEquals(postIndex);
    initialNumberOfPosts.assertEquals(postIndex.sub(1));

    postState.deletedAtBlockHeight.assertEquals(Field(0));

    const postsRootAfter = postWitness.calculateRoot(postState.hash());
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      initialNumberOfPosts: initialNumberOfPosts,
      latestNumberOfPosts: postIndex,
      blockHeight: postState.postedAtBlockHeight,
    });
  }

  static assertEquals(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.initialPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestPostsRoot.assertEquals(transition2.latestPostsRoot);
    transition1.initialNumberOfPosts.assertEquals(
      transition2.initialNumberOfPosts
    );
    transition1.latestNumberOfPosts.assertEquals(
      transition2.latestNumberOfPosts
    );
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }

  static mergePostsTransitions(
    transition1: PostsTransition,
    transition2: PostsTransition
  ) {
    transition1.latestPostsRoot.assertEquals(transition2.initialPostsRoot);
    transition1.latestNumberOfPosts.assertEquals(
      transition2.initialNumberOfPosts
    );
    transition1.blockHeight.assertEquals(transition2.blockHeight);

    return new PostsTransition({
      initialPostsRoot: transition1.initialPostsRoot,
      latestPostsRoot: transition2.latestPostsRoot,
      initialNumberOfPosts: transition1.initialNumberOfPosts,
      latestNumberOfPosts: transition2.latestNumberOfPosts,
      blockHeight: transition2.blockHeight,
    });
  }

  static createPostDeletionTransition(
    signature: Signature,
    initialPostState: PostState,

    initialPostsRoot: Field,
    latestPostsRoot: Field,
    postWitness: PostsWitness,

    numberOfPosts: Field,
    blockHeight: Field
  ) {
    const postStateHash = initialPostState.hash();
    const isSigned = signature.verify(initialPostState.posterAddress, [
      postStateHash,
      fieldToFlagPostsAsDeleted,
    ]);
    isSigned.assertTrue();

    const postsRootBefore = postWitness.calculateRoot(initialPostState.hash());
    initialPostsRoot.assertEquals(postsRootBefore);

    const latestPostState = new PostState({
      posterAddress: initialPostState.posterAddress,
      postContentID: initialPostState.postContentID,
      postIndex: initialPostState.postIndex,
      postedAtBlockHeight: initialPostState.postedAtBlockHeight,
      deletedAtBlockHeight: blockHeight,
    });

    const postsRootAfter = postWitness.calculateRoot(latestPostState.hash());
    postsRootAfter.assertEquals(latestPostsRoot);

    return new PostsTransition({
      initialPostsRoot: initialPostsRoot,
      latestPostsRoot: latestPostsRoot,
      initialNumberOfPosts: numberOfPosts,
      latestNumberOfPosts: numberOfPosts,
      blockHeight: blockHeight,
    });
  }
}

// ============================================================================

export const Posts = Experimental.ZkProgram({
  publicInput: PostsTransition,

  methods: {
    provePostsTransition: {
      privateInputs: [Signature, PostState, Field, Field, PostsWitness, Field],

      method(
        transition: PostsTransition,
        signature: Signature,
        postState: PostState,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        postWitness: PostsWitness,
        initialPostsNumber: Field
      ) {
        const computedTransition = PostsTransition.createPostsTransition(
          signature,
          postState,
          initialPostsRoot,
          latestPostsRoot,
          postWitness,
          initialPostsNumber
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveMergedPostsTransitions: {
      privateInputs: [SelfProof, SelfProof],

      method(
        mergedPostsTransitions: PostsTransition,
        postsTransition1Proof: SelfProof<PostsTransition, undefined>,
        postsTransition2Proof: SelfProof<PostsTransition, undefined>
      ) {
        postsTransition1Proof.verify();
        postsTransition2Proof.verify();

        postsTransition1Proof.publicInput.latestPostsRoot.assertEquals(
          postsTransition2Proof.publicInput.initialPostsRoot
        );
        postsTransition1Proof.publicInput.initialPostsRoot.assertEquals(
          mergedPostsTransitions.initialPostsRoot
        );
        postsTransition2Proof.publicInput.latestPostsRoot.assertEquals(
          mergedPostsTransitions.latestPostsRoot
        );

        postsTransition1Proof.publicInput.latestNumberOfPosts.assertEquals(
          postsTransition2Proof.publicInput.initialNumberOfPosts
        );
        postsTransition1Proof.publicInput.initialNumberOfPosts
          .add(1)
          .assertEquals(postsTransition1Proof.publicInput.latestNumberOfPosts);
        postsTransition2Proof.publicInput.initialNumberOfPosts
          .add(1)
          .assertEquals(postsTransition2Proof.publicInput.latestNumberOfPosts);

        postsTransition1Proof.publicInput.initialNumberOfPosts.assertEquals(
          mergedPostsTransitions.initialNumberOfPosts
        );
        postsTransition2Proof.publicInput.latestNumberOfPosts.assertEquals(
          mergedPostsTransitions.latestNumberOfPosts
        );

        postsTransition1Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
        postsTransition2Proof.publicInput.blockHeight.assertEquals(
          mergedPostsTransitions.blockHeight
        );
      },
    },

    provePostDeletionTransition: {
      privateInputs: [
        Signature,
        PostState,
        Field,
        Field,
        PostsWitness,
        Field,
        Field,
      ],

      method(
        transition: PostsTransition,
        signature: Signature,
        initialPostState: PostState,
        initialPostsRoot: Field,
        latestPostsRoot: Field,
        postWitness: PostsWitness,
        postsNumber: Field,
        blockHeight: Field
      ) {
        const computedTransition = PostsTransition.createPostDeletionTransition(
          signature,
          initialPostState,
          initialPostsRoot,
          latestPostsRoot,
          postWitness,
          postsNumber,
          blockHeight
        );
        PostsTransition.assertEquals(computedTransition, transition);
      },
    },

    proveMergedPostsDeletions: {
      privateInputs: [SelfProof, SelfProof],

      method(
        mergedPostsDeletions: PostsTransition,
        postsDeletion1Proof: SelfProof<PostsTransition, undefined>,
        postsDeletion2Proof: SelfProof<PostsTransition, undefined>
      ) {
        postsDeletion1Proof.verify();
        postsDeletion2Proof.verify();

        postsDeletion1Proof.publicInput.latestPostsRoot.assertEquals(
          postsDeletion2Proof.publicInput.initialPostsRoot
        );
        postsDeletion1Proof.publicInput.initialPostsRoot.assertEquals(
          mergedPostsDeletions.initialPostsRoot
        );
        postsDeletion2Proof.publicInput.latestPostsRoot.assertEquals(
          mergedPostsDeletions.latestPostsRoot
        );

        postsDeletion1Proof.publicInput.initialNumberOfPosts.assertEquals(
          postsDeletion2Proof.publicInput.initialNumberOfPosts
        );
        postsDeletion1Proof.publicInput.latestNumberOfPosts.assertEquals(
          postsDeletion2Proof.publicInput.latestNumberOfPosts
        );

        postsDeletion1Proof.publicInput.initialNumberOfPosts.assertEquals(
          mergedPostsDeletions.initialNumberOfPosts
        );
        postsDeletion1Proof.publicInput.latestNumberOfPosts.assertEquals(
          mergedPostsDeletions.latestNumberOfPosts
        );

        postsDeletion1Proof.publicInput.blockHeight.assertEquals(
          mergedPostsDeletions.blockHeight
        );
        postsDeletion2Proof.publicInput.blockHeight.assertEquals(
          mergedPostsDeletions.blockHeight
        );
      },
    },
  },
});

export let PostsProof_ = Experimental.ZkProgram.Proof(Posts);
export class PostsProof extends PostsProof_ {}

// ============================================================================
