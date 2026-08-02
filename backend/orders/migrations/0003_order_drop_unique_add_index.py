from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('orders', '0002_initial'),
        ('integrations', '0001_initial'),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name='order',
            unique_together=set(),
        ),
        migrations.AddIndex(
            model_name='order',
            index=models.Index(fields=['platform', 'external_id'], name='orders_orde_platfor_extid_idx'),
        ),
    ]
