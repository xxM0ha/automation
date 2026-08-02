from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0008_printer'),
        ('menu', '0005_menuitemplatform_pos_category'),
    ]

    operations = [
        migrations.AddField(
            model_name='menuitem',
            name='printer',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='items', to='integrations.printer'),
        ),
    ]
