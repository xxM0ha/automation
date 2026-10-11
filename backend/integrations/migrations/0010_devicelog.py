from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0009_webhookrejection_suggestions'),
        ('restaurants', '0005_user_branch_username_organization_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='DeviceLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('source', models.CharField(choices=[('app', 'Android app'), ('adb', 'ADB runner')], default='app', max_length=10)),
                ('device_id', models.CharField(blank=True, default='', max_length=100)),
                ('device_model', models.CharField(blank=True, default='', max_length=120)),
                ('os_version', models.CharField(blank=True, default='', max_length=40)),
                ('app_version', models.CharField(blank=True, default='', max_length=40)),
                ('platform', models.CharField(blank=True, default='', max_length=60)),
                ('kind', models.CharField(blank=True, default='flow', max_length=20)),
                ('message', models.TextField()),
                ('context', models.JSONField(blank=True, default=list)),
                ('screen_package', models.CharField(blank=True, default='', max_length=200)),
                ('screen_texts', models.JSONField(blank=True, default=list)),
                ('count', models.PositiveIntegerField(default=1)),
                ('occurred_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('restaurant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='device_logs', to='restaurants.restaurant')),
            ],
            options={
                'ordering': ['-occurred_at'],
                'indexes': [models.Index(fields=['restaurant', '-occurred_at'], name='devicelog_rest_occurred_idx')],
            },
        ),
    ]
