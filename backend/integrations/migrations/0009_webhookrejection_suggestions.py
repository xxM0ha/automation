from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0008_printer'),
    ]

    operations = [
        migrations.AddField(
            model_name='webhookrejection',
            name='suggestions',
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
