# Generated manually for the Page folders Community feature.

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models.functions import Lower


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("db", "0121_alter_estimate_type"),
    ]

    operations = [
        migrations.CreateModel(
            name="PageFolder",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        db_index=True,
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                        unique=True,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="Created At")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="Last Modified At")),
                ("deleted_at", models.DateTimeField(blank=True, null=True, verbose_name="Deleted At")),
                ("name", models.CharField(max_length=255)),
                (
                    "access",
                    models.PositiveSmallIntegerField(choices=[(1, "Private"), (0, "Public")], default=0),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_created_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Created By",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="%(class)s_updated_by",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="Last Modified By",
                    ),
                ),
                (
                    "owned_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="page_folders",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="page_folders",
                        to="db.project",
                    ),
                ),
                (
                    "workspace",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="page_folders",
                        to="db.workspace",
                    ),
                ),
            ],
            options={
                "verbose_name": "Page Folder",
                "verbose_name_plural": "Page Folders",
                "db_table": "page_folders",
                "ordering": ("name", "created_at"),
            },
        ),
        migrations.AddConstraint(
            model_name="pagefolder",
            constraint=models.UniqueConstraint(
                Lower("name"),
                "project",
                condition=models.Q(("access", 0), ("deleted_at__isnull", True)),
                name="page_folder_unique_public_name",
            ),
        ),
        migrations.AddConstraint(
            model_name="pagefolder",
            constraint=models.UniqueConstraint(
                Lower("name"),
                "project",
                "owned_by",
                condition=models.Q(("access", 1), ("deleted_at__isnull", True)),
                name="page_folder_unique_private_name",
            ),
        ),
        migrations.AddField(
            model_name="page",
            name="folder",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="pages",
                to="db.pagefolder",
            ),
        ),
    ]
