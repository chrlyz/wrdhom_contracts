import {
  Field,
  Struct,
  PublicKey,
  Signature,
  Poseidon,
  ZkProgram,
  MerkleMapWitness,
  Bool,
  CircuitString,
} from 'o1js';
import { PostState } from '../posts/Posts.js';

// ============================================================================

export class CommentState extends Struct({
  isTargetPost: Bool,
  targetKey: Field,
  commenterAddress: PublicKey,
  commentContentID: CircuitString,
  allCommentsCounter: Field,
  userCommentsCounter: Field,
  targetCommentsCounter: Field,
  commentBlockHeight: Field,
  deletionBlockHeight: Field,
  restorationBlockHeight: Field,
}) {
  hash(): Field {
    return Poseidon.hash(
      this.isTargetPost
        .toFields()
        .concat(
          this.targetKey,
          this.commenterAddress
            .toFields()
            .concat([
              this.commentContentID.hash(),
              this.allCommentsCounter,
              this.userCommentsCounter,
              this.targetCommentsCounter,
              this.commentBlockHeight,
              this.deletionBlockHeight,
              this.restorationBlockHeight,
            ])
        )
    );
  }
}

// ============================================================================

export class CommentsTransition extends Struct({
  targets: Field,
  initialAllCommentsCounter: Field,
  latestAllCommentsCounter: Field,
  initialUsersCommentsCounters: Field,
  latestUsersCommentsCounters: Field,
  initialTargetsCommentsCounters: Field,
  latestTargetsCommentsCounters: Field,
  initialComments: Field,
  latestComments: Field,
  blockHeight: Field,
}) {
  static createCommentPublishingTransition(
    signature: Signature,
    targets: Field,
    targetState: PostState,
    targetWitness: MerkleMapWitness,
    initialAllCommentsCounter: Field,
    initialUsersCommentsCounters: Field,
    latestUsersCommentsCounters: Field,
    initialUserCommentsCounter: Field,
    userCommentsCounterWitness: MerkleMapWitness,
    initialTargetsCommentsCounters: Field,
    latestTargetsCommentsCounters: Field,
    initialTargetCommentsCounter: Field,
    targetCommentsCounterWitness: MerkleMapWitness,
    initialComments: Field,
    latestComments: Field,
    commentWitness: MerkleMapWitness,
    commentState: CommentState
  ) {
    initialAllCommentsCounter.assertEquals(
      commentState.allCommentsCounter.sub(1)
    );
    commentState.deletionBlockHeight.assertEquals(Field(0));
    commentState.restorationBlockHeight.assertEquals(Field(0));

    const [targetsRoot, targetKey] = targetWitness.computeRootAndKey(
      targetState.hash()
    );
    targetsRoot.assertEquals(targets);
    targetKey.assertEquals(commentState.targetKey);

    const isSigned = signature.verify(commentState.commenterAddress, [
      targetKey,
      commentState.commentContentID.hash(),
    ]);
    isSigned.assertTrue();

    const [usersCommentsCountersBefore, userCommentsCounterKey] =
      userCommentsCounterWitness.computeRootAndKey(initialUserCommentsCounter);
    usersCommentsCountersBefore.assertEquals(initialUsersCommentsCounters);
    const commenterAddressAsField = Poseidon.hash(
      commentState.commenterAddress.toFields()
    );
    userCommentsCounterKey.assertEquals(commenterAddressAsField);
    initialUserCommentsCounter.assertEquals(
      commentState.userCommentsCounter.sub(1)
    );
    const usersCommentsCountersAfter =
      userCommentsCounterWitness.computeRootAndKey(
        commentState.userCommentsCounter
      )[0];
    usersCommentsCountersAfter.assertEquals(latestUsersCommentsCounters);

    const [targetsCommentsCountersBefore, targetCommentsCounterKey] =
      targetCommentsCounterWitness.computeRootAndKey(
        initialTargetCommentsCounter
      );
    targetsCommentsCountersBefore.assertEquals(initialTargetsCommentsCounters);
    targetCommentsCounterKey.assertEquals(targetKey);
    initialTargetCommentsCounter.assertEquals(
      commentState.targetCommentsCounter.sub(1)
    );
    const targetsCommentsCountersAfter =
      targetCommentsCounterWitness.computeRootAndKey(
        commentState.targetCommentsCounter
      )[0];
    targetsCommentsCountersAfter.assertEquals(latestTargetsCommentsCounters);

    const [commentsBefore, commentKey] = commentWitness.computeRootAndKey(
      Field(0)
    );
    commentsBefore.assertEquals(initialComments);
    commentKey.assertEquals(
      Poseidon.hash([
        targetKey,
        commenterAddressAsField,
        commentState.commentContentID.hash(),
      ])
    );
    const commentsAfter = commentWitness.computeRootAndKey(
      commentState.hash()
    )[0];
    commentsAfter.assertEquals(latestComments);

    return new CommentsTransition({
      targets: targetsRoot,
      initialAllCommentsCounter: initialAllCommentsCounter,
      latestAllCommentsCounter: commentState.allCommentsCounter,
      initialUsersCommentsCounters: usersCommentsCountersBefore,
      latestUsersCommentsCounters: usersCommentsCountersAfter,
      initialTargetsCommentsCounters: targetsCommentsCountersBefore,
      latestTargetsCommentsCounters: targetsCommentsCountersAfter,
      initialComments: commentsBefore,
      latestComments: commentsAfter,
      blockHeight: commentState.commentBlockHeight,
    });
  }

  static assertEquals(
    transition1: CommentsTransition,
    transition2: CommentsTransition
  ) {
    transition1.initialAllCommentsCounter.assertEquals(
      transition2.initialAllCommentsCounter
    );
    transition1.latestAllCommentsCounter.assertEquals(
      transition2.latestAllCommentsCounter
    );
    transition1.initialUsersCommentsCounters.assertEquals(
      transition2.initialUsersCommentsCounters
    );
    transition1.latestUsersCommentsCounters.assertEquals(
      transition2.latestUsersCommentsCounters
    );
    transition1.initialTargetsCommentsCounters.assertEquals(
      transition2.initialTargetsCommentsCounters
    );
    transition1.latestTargetsCommentsCounters.assertEquals(
      transition2.latestTargetsCommentsCounters
    );
    transition1.initialComments.assertEquals(transition2.initialComments);
    transition1.latestComments.assertEquals(transition2.latestComments);
    transition1.blockHeight.assertEquals(transition2.blockHeight);
  }
}

// ============================================================================

export const Comments = ZkProgram({
  name: 'Comments',
  publicInput: CommentsTransition,

  methods: {
    proveCommentPublishingTransition: {
      privateInputs: [
        Signature,
        Field,
        PostState,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        Field,
        MerkleMapWitness,
        Field,
        Field,
        MerkleMapWitness,
        CommentState,
      ],

      method(
        transition: CommentsTransition,
        signature: Signature,
        targets: Field,
        targetState: PostState,
        targetWitness: MerkleMapWitness,
        initialAllCommentsCounter: Field,
        initialUsersCommentsCounters: Field,
        latestUsersCommentsCounters: Field,
        initialUserCommentsCounter: Field,
        userCommentsCounterWitness: MerkleMapWitness,
        initialTargetsCommentsCounters: Field,
        latestTargetsCommentsCounters: Field,
        initialTargetCommentsCounter: Field,
        targetCommentsCounterWitness: MerkleMapWitness,
        initialComments: Field,
        latestComments: Field,
        commentWitness: MerkleMapWitness,
        commentState: CommentState
      ) {
        const computedTransition =
          CommentsTransition.createCommentPublishingTransition(
            signature,
            targets,
            targetState,
            targetWitness,
            initialAllCommentsCounter,
            initialUsersCommentsCounters,
            latestUsersCommentsCounters,
            initialUserCommentsCounter,
            userCommentsCounterWitness,
            initialTargetsCommentsCounters,
            latestTargetsCommentsCounters,
            initialTargetCommentsCounter,
            targetCommentsCounterWitness,
            initialComments,
            latestComments,
            commentWitness,
            commentState
          );
        CommentsTransition.assertEquals(computedTransition, transition);
      },
    },
  },
});

export let CommentsProof_ = ZkProgram.Proof(Comments);
export class CommentsProof extends CommentsProof_ {}

// ============================================================================
