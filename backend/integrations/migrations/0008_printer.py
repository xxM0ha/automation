from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('integrations', '0007_printjob'),
        ('restaurants', '0004_restaurant_printing_enabled'),
    ]

    operations = [
        migrations.CreateModel(
            name='Printer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('ip', models.CharField(max_length=64)),
                ('port', models.PositiveIntegerField(default=9100)),
                ('paper_width', models.PositiveIntegerField(default=576)),
                ('role', models.CharField(choices=[('station', 'محطة'), ('cashier', 'كاشير')], default='station', max_length=20)),
                ('active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('restaurant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='printers', to='restaurants.restaurant')),
            ],
            options={'ordering': ['name']},
        ),
    ]
