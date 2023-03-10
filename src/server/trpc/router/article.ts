import { z } from 'zod';

import { protectedProcedure, router } from '../trpc';
import { articleSchema } from '../schemas/articleSchemas';
import type {
    Article,
    Category,
    TagsOnPosts,
    User,
    Vote,
} from '@prisma/client';
import { trigger } from '../../../utils/pusher';

export interface ArticleWithRelations extends Article {
    category: Category;
    tagsOnPosts: TagsOnPosts[];
    Vote: Vote[];
    createdBy: User;
}

export interface CategorizedArticles {
    [x: Category['name']]: ArticleWithRelations[];
}

export const articleRouter = router({
    getCategories: protectedProcedure.query(({ ctx }) => {
        return ctx.prisma.category.findMany();
    }),
    getArticles: protectedProcedure
        .input(
            z.object({
                published: z.boolean(),
                categoryId: z.string().cuid().optional(),
            })
        )
        .query(({ ctx, input }) => {
            return ctx.prisma.article.findMany({
                where: {
                    ...(input.published
                        ? {
                              newsletterId: {
                                  not: null,
                              },
                          }
                        : { newsletterId: null }),
                    ...(input.categoryId
                        ? {
                              categoryId: input.categoryId,
                          }
                        : {}),
                },
                include: {
                    category: true,
                    Vote: true,
                    createdBy: true,
                    tagsOnPosts: true,
                },
            });
        }),
    postArticle: protectedProcedure
        .input(articleSchema)
        .mutation(async ({ ctx, input }) => {
            const {
                title,
                description,
                category: categoryId,
                user: userId,
                link: URL,
            } = input;

            await trigger({
                channel: 'article-channel',
                event: 'article-event',
                data: {
                    categoryId,
                    userId,
                },
            });

            return ctx.prisma.article.create({
                data: {
                    categoryId,
                    title,
                    description,
                    userId,
                    URL,
                },
            });
        }),
    toggleVote: protectedProcedure
        .input(
            z.object({
                articleId: z.string().cuid(),
                categoryId: z.string().cuid(),
            })
        )
        .mutation(async ({ ctx, input }) => {
            const { articleId } = input;
            const {
                user: { id: userId },
            } = ctx.session;
            const vote = await ctx.prisma.vote.findFirst({
                where: {
                    articleId,
                    userId,
                },
            });

            vote
                ? await ctx.prisma.vote.delete({
                      where: {
                          id: vote.id,
                      },
                  })
                : await ctx.prisma.vote.create({
                      data: {
                          articleId,
                          userId,
                      },
                  });

            await trigger({
                channel: 'article-channel',
                event: 'article-event',
                data: {
                    categoryId: input.categoryId,
                    userId,
                },
            });

            return { categoryId: input.categoryId };
        }),
});
