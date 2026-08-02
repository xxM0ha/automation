from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('restaurants', '0002_alter_user_managers'),
    ]

    operations = [
        migrations.AddField(
            model_name='restaurant',
            name='foodics_branch',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
    ]
